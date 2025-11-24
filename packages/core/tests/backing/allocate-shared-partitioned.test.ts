import { describe, expect, it } from "vitest";

import { allocateSharedPartitioned } from "../../src/backing/allocate-shared-partitioned";
import { mapViews } from "../../src/backing/map-views";
import { planLayout } from "../../src/plan/layout";
import { BYTES_PER_ELEM } from "../../src/primitives/planes";
import { defineSpec } from "../../src/spec/define";
import { specFromPlaneBytes } from "../helpers/spec-from-bytes";

import type { SharedPartitionedBacking } from "../../src/backing/types";

const BYTES_F32 = 4;
const BYTES_F64 = 8;

/**
 * Truncates a value `n` to the nearest lower multiple of `q`.
 * Used to verify TypedArray view limits (which ignore trailing partial bytes).
 */
const floorTo = (n: number, q: number): number => Math.trunc(n / q) * q;

describe("Shared Partitioned Allocation (Split Backing)", () => {
  it("allocates and maps partitioned planes with byte lengths correctly aligned to element sizes", () => {
    // Define explicit plane sizes. We deliberately include an MF64 size that is
    // not a multiple of 8 to verify that the view mapping correctly floors the size.
    const bytes = {
      PF32: 16 * BYTES_F32, // 64
      PI32: 4 * BYTES_F32, // 16
      PB: 32, // Byte plane: exact mapping expected
      PU: 2 * BYTES_F32, // 8
      MF32: 7 * BYTES_F32, // 28
      MF64: 13 * BYTES_F64, // 104 (View floors to closest 8-byte boundary)
      MU32: 5 * BYTES_F32, // 20
      MU: 2 * BYTES_F32, // 8
    };

    const plan = planLayout(specFromPlaneBytes(bytes));
    const split = allocateSharedPartitioned(plan);
    const v = mapViews(plan, split);

    // Parameter Views
    expect(v.params.PF32.byteLength).toBe(
      floorTo(plan.planes.PF32, BYTES_PER_ELEM.PF32),
    );
    expect(v.params.PI32.byteLength).toBe(
      floorTo(plan.planes.PI32, BYTES_PER_ELEM.PI32),
    );
    expect(v.params.PB.byteLength).toBe(plan.planes.PB);
    expect(v.params.PU.byteLength).toBe(
      floorTo(plan.planes.PU, BYTES_PER_ELEM.PU),
    );

    // Meter Views
    expect(v.meters.MF32.byteLength).toBe(
      floorTo(plan.planes.MF32, BYTES_PER_ELEM.MF32),
    );
    expect(v.meters.MF64.byteLength).toBe(
      floorTo(plan.planes.MF64, BYTES_PER_ELEM.MF64),
    );
    expect(v.meters.MU32.byteLength).toBe(
      floorTo(plan.planes.MU32, BYTES_PER_ELEM.MU32),
    );
    expect(v.meters.MU.byteLength).toBe(
      floorTo(plan.planes.MU, BYTES_PER_ELEM.MU),
    );

    // Locks (Aliases to PU/MU views)
    expect(v.locks.PU.byteLength).toBe(
      floorTo(plan.planes.PU, BYTES_PER_ELEM.PU),
    );
    expect(v.locks.MU.byteLength).toBe(
      floorTo(plan.planes.MU, BYTES_PER_ELEM.MU),
    );
  });

  it("throws specifically when a partitioned plane buffer is smaller than the planned requirement", () => {
    // Define a spec that guarantees the boolean plane (PB) has size > 0
    const specPB = defineSpec(({ param }) => ({
      id: "split-pb-validation",
      params: {
        flags: param.bool.array(64), // Occupies 64 bytes in PB
        kf: param.f32.array(4), // Ensures PF32 presence
      },
    }));

    const plan = planLayout(specPB);

    // Verify precondition: PB must be positive
    const plannedPB = plan.planes.PB;
    expect(plannedPB).toBeGreaterThan(0);

    // Allocate valid backing, then surgically replace PB with an undersized buffer
    const split = allocateSharedPartitioned(plan);

    // Create a buffer that is valid (multiple of 4) but strictly smaller than required
    const pbUndersized = Math.max(4, floorTo(plannedPB, 4) - 4);

    const badBacking: SharedPartitionedBacking = {
      kind: "shared-partitioned",
      planes: {
        ...split.planes,
        PB: new SharedArrayBuffer(pbUndersized),
      },
    };

    // Validation should occur during view mapping
    expect(() => mapViews(plan, badBacking)).toThrow(/Plane PB.*too small/i);
  });
});
