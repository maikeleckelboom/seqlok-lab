import { describe, expect, it } from "vitest";

import { mapViews } from "../../src/backing/map-views";
import { planLayout } from "../../src/plan/layout";
import { specFromPlaneBytes } from "../helpers/spec-from-bytes";

import type { WasmSharedBacking } from "../../src/backing/types";
import type { PlaneByteLengths } from "../../src/plan/types";

const BYTES_F32 = 4;
const BYTES_F64 = 8;
const WASM_PAGE_SIZE = 64 * 1024;

/**
 * Calculates the minimum number of WebAssembly pages required to contain
 * the specified number of bytes.
 */
function pagesForBytes(bytes: number): number {
  return Math.ceil(bytes / WASM_PAGE_SIZE);
}

describe("Map Views: WebAssembly Shared Memory", () => {
  it("correctly maps views from WebAssembly shared memory according to planned byte lengths", () => {
    // Define specific byte requirements for various planes to verify mapping precision
    const req: PlaneByteLengths = {
      PF32: 8 * BYTES_F32,
      PI32: 4 * BYTES_F32,
      PB: 10,
      PU: 2 * BYTES_F32,
      MF32: 6 * BYTES_F32,
      MF64: 3 * BYTES_F64,
      MU32: 3 * BYTES_F32,
      MU: 2 * BYTES_F32,
    };

    const plan = planLayout(specFromPlaneBytes(req));

    // Allocate Wasm shared memory based on the plan's total size requirements
    const memory = new WebAssembly.Memory({
      shared: true,
      initial: pagesForBytes(plan.bytesTotal),
      maximum: pagesForBytes(plan.bytesTotal),
    });

    const backing: WasmSharedBacking = { kind: "wasm-shared", memory };
    const v = mapViews(plan, backing);

    // Verify that the mapped view lengths match the plan exactly
    expect(v.params.PF32.byteLength).toBe(plan.planes.PF32);
    expect(v.params.PI32.byteLength).toBe(plan.planes.PI32);
    expect(v.params.PB.byteLength).toBe(plan.planes.PB);
    expect(v.params.PU.byteLength).toBe(plan.planes.PU);
    expect(v.meters.MF32.byteLength).toBe(plan.planes.MF32);
    expect(v.meters.MF64.byteLength).toBe(plan.planes.MF64);
    expect(v.meters.MU32.byteLength).toBe(plan.planes.MU32);
    expect(v.locks.MU.byteLength).toBe(plan.planes.MU);
  });
});
