import { describe, expect, it } from "vitest";

import {
  BACKING_PLANE_PACK_ORDER_V1,
  computeBackingPlaneBases,
} from "../../src/backing/map-views";
import { planLayout } from "../../src/plan/layout";
import { specFromPlaneBytes } from "../helpers/spec-from-bytes";

const BYTES_F32 = 4;
const BYTES_F64 = 8;

describe("Backing Plane Layout Calculation", () => {
  it("calculates contiguous base offsets matching the V1 packing order and total size", () => {
    // Define mixed plane sizes to verify arithmetic contiguity across different types
    const planeSizes = {
      PF32: 8 * BYTES_F32,
      PI32: 5 * BYTES_F32,
      PB: 13, // Prime/odd size to ensure no accidental alignment masking
      PU: 2 * BYTES_F32,
      MF32: 10 * BYTES_F32,
      MF64: 3 * BYTES_F64,
      MU32: 4 * BYTES_F32,
      MU: 2 * BYTES_F32,
    };

    const plan = planLayout(specFromPlaneBytes(planeSizes));
    const bases = computeBackingPlaneBases(plan.planes);

    let accumulatedOffset = 0;

    // Iterate through the strict V1 packing order to verify linear layout
    for (const plane of BACKING_PLANE_PACK_ORDER_V1) {
      const actualBase = bases[plane];
      expect(actualBase).toBe(accumulatedOffset);

      accumulatedOffset += plan.planes[plane];
    }

    // The final accumulated offset must exactly match the plan's total byte count
    expect(accumulatedOffset).toBe(plan.bytesTotal);
  });
});
