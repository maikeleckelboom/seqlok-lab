import { describe, expect, it } from "vitest";

import { allocateSharedPartitioned } from "../../src/backing/allocate-shared-partitioned";
import { mapViews } from "../../src/backing/map-views";
import { planLayout } from "../../src/plan/layout";
import { specFromPlaneBytes } from "../helpers/spec-from-bytes";

import type { SharedBacking } from "../../src/backing/types";
import type { PlaneByteLengths } from "../../src/plan/types";

const BYTES_F32 = 4;
const BYTES_F64 = 8;

/**
 * Define varied layout scenarios to verify mapping consistency:
 * 1. Standard mixed usage.
 * 2. Zero-length planes (edge case).
 * 3. Larger allocations (stress test).
 */
const TEST_CASES: readonly PlaneByteLengths[] = [
  {
    PF32: 5 * BYTES_F32,
    PI32: 2 * BYTES_F32,
    PB: 3,
    PU: BYTES_F32,
    MF32: 4 * BYTES_F32,
    MF64: BYTES_F64,
    MU32: BYTES_F32,
    MU: BYTES_F32,
  },
  {
    PF32: 0,
    PI32: 0,
    PB: 0,
    PU: 2 * BYTES_F32,
    MF32: 0,
    MF64: 0,
    MU32: 0,
    MU: 2 * BYTES_F32,
  },
  {
    PF32: 16 * BYTES_F32,
    PI32: 8 * BYTES_F32,
    PB: 32,
    PU: 4 * BYTES_F32,
    MF32: 12 * BYTES_F32,
    MF64: 9 * BYTES_F64,
    MU32: 6 * BYTES_F32,
    MU: 4 * BYTES_F32,
  },
];

describe("Map Views: Parity & Layout Consistency", () => {
  it("ensures view byte lengths match the planned layout", () => {
    for (const req of TEST_CASES) {
      const plan = planLayout(specFromPlaneBytes(req));

      // 1. Partitioned Allocation (Split Backing)
      const splitBacking = allocateSharedPartitioned(plan);
      const vSplit = mapViews(plan, splitBacking);

      // 2. Contiguous Allocation (Single SAB)
      const contiguousBacking: SharedBacking = {
        kind: "shared",
        sab: new SharedArrayBuffer(plan.bytesTotal),
      };
      const vContiguous = mapViews(plan, contiguousBacking);

      // Verify Split Backing matches Plan
      expect(vSplit.params.PF32.byteLength).toBe(plan.planes.PF32);
      expect(vSplit.params.PI32.byteLength).toBe(plan.planes.PI32);
      expect(vSplit.params.PB.byteLength).toBe(plan.planes.PB);
      expect(vSplit.params.PU.byteLength).toBe(plan.planes.PU);
      expect(vSplit.meters.MF32.byteLength).toBe(plan.planes.MF32);
      expect(vSplit.meters.MF64.byteLength).toBe(plan.planes.MF64);
      expect(vSplit.meters.MU32.byteLength).toBe(plan.planes.MU32);
      expect(vSplit.locks.MU.byteLength).toBe(plan.planes.MU);

      // Verify Contiguous Backing matches Plan
      expect(vContiguous.params.PF32.byteLength).toBe(plan.planes.PF32);
      expect(vContiguous.params.PI32.byteLength).toBe(plan.planes.PI32);
      expect(vContiguous.params.PB.byteLength).toBe(plan.planes.PB);
      expect(vContiguous.params.PU.byteLength).toBe(plan.planes.PU);
      expect(vContiguous.meters.MF32.byteLength).toBe(plan.planes.MF32);
      expect(vContiguous.meters.MF64.byteLength).toBe(plan.planes.MF64);
      expect(vContiguous.meters.MU32.byteLength).toBe(plan.planes.MU32);
      expect(vContiguous.locks.MU.byteLength).toBe(plan.planes.MU);
    }
  });
});
