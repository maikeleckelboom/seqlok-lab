import { describe, expect, it } from "vitest";

import { mapViews } from "../../src/backing/map-views";
import { planLayout } from "../../src/plan/layout";
import { specFromPlaneBytes } from "../helpers/spec-from-bytes";

const BYTES_F32 = 4;

describe("Map Views (Contiguous Layout)", () => {
  it("correctly maps zero-length byte planes while preserving subsequent lock views", () => {
    const planeSizes = {
      // Define non-zero predecessor planes to establish non-zero offsets
      PF32: 8 * BYTES_F32,
      PI32: 4 * BYTES_F32,
      // Explicitly zero-length plane to test boundary condition handling
      PB: 0,
      // Parameter locks (u32) must exist and map correctly after the zero-length plane
      PU: 2 * BYTES_F32,
      MF32: 0,
      MF64: 0,
      MU32: 0,
      // Meter locks (u32)
      MU: 2 * BYTES_F32,
    };

    const plan = planLayout(specFromPlaneBytes(planeSizes));
    const sab = new SharedArrayBuffer(plan.bytesTotal);
    const v = mapViews(plan, { kind: "shared", sab });

    // The boolean/byte plane should reflect the requested zero-length exactly
    expect(v.params.PB.byteLength).toBe(0);

    // Locks should still be present and correctly offset despite the preceding zero-length plane
    expect(v.locks.PU.byteLength).toBe(plan.planes.PU);
    expect(v.locks.MU.byteLength).toBe(plan.planes.MU);
  });
});
