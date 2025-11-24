import fc from "fast-check";
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
 * Generates arbitrary valid plane byte length configurations.
 * Ensures alignment constraints (multiples of 4 or 8) are met and that
 * the resulting specification is not completely empty.
 */
function arbPlaneBytes(): fc.Arbitrary<PlaneByteLengths> {
  const mul4 = fc.integer({ min: 0, max: 256 }).map((n) => n * BYTES_F32);
  const mul8 = fc.integer({ min: 0, max: 128 }).map((n) => n * BYTES_F64);
  const anyByte = fc.integer({ min: 0, max: 512 });

  return fc
    .record<PlaneByteLengths>({
      PF32: mul4,
      PI32: mul4,
      PB: anyByte,
      PU: mul4,
      MF32: mul4,
      MF64: mul8,
      MU32: mul4,
      MU: mul4,
    })
    .filter((b) => b.PF32 + b.PI32 + b.MF32 + b.MF64 > 0);
}

describe("Map Views: Parity & Consistency (Property-Based)", () => {
  it("ensures mapped view byte lengths are identical across contiguous and partitioned backings", () => {
    fc.assert(
      fc.property(arbPlaneBytes(), (req) => {
        const plan = planLayout(specFromPlaneBytes(req));

        // Strategy A: Contiguous SharedArrayBuffer
        const contiguousBacking: SharedBacking = {
          kind: "shared",
          sab: new SharedArrayBuffer(plan.bytesTotal),
        };

        // Strategy B: Partitioned (Split) Backing
        const partitionedBacking = allocateSharedPartitioned(plan);

        const viewsContiguous = mapViews(plan, contiguousBacking);
        const viewsPartitioned = mapViews(plan, partitionedBacking);

        // Parameter Views
        expect(viewsPartitioned.params.PF32.byteLength).toBe(
          viewsContiguous.params.PF32.byteLength,
        );
        expect(viewsPartitioned.params.PI32.byteLength).toBe(
          viewsContiguous.params.PI32.byteLength,
        );
        expect(viewsPartitioned.params.PB.byteLength).toBe(
          viewsContiguous.params.PB.byteLength,
        );
        expect(viewsPartitioned.params.PU.byteLength).toBe(
          viewsContiguous.params.PU.byteLength,
        );

        // Meter Views
        expect(viewsPartitioned.meters.MF32.byteLength).toBe(
          viewsContiguous.meters.MF32.byteLength,
        );
        expect(viewsPartitioned.meters.MF64.byteLength).toBe(
          viewsContiguous.meters.MF64.byteLength,
        );
        expect(viewsPartitioned.meters.MU32.byteLength).toBe(
          viewsContiguous.meters.MU32.byteLength,
        );

        // Lock Views
        expect(viewsPartitioned.locks.MU.byteLength).toBe(
          viewsContiguous.locks.MU.byteLength,
        );
      }),
    );
  });
});
