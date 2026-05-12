import { describe, expect, it } from "vitest";

import { allocateShared, planLayout } from "../../src";

import type { CanonicalSpec } from "@seqlok/schema";

/**
 * Helper to construct a specification with explicit byte-size targets for
 * boolean (PB) and float32 (PF32) planes to test allocation sizing.
 */
function makeSpec(bytesPB: number, bytesPF32: number): CanonicalSpec {
  return {
    id: "demo",
    params: {
      flags: { kind: "bool.array", length: bytesPB },
      // Calculate array length to match requested byte count (f32 = 4 bytes)
      table: { kind: "f32.array", length: Math.ceil(bytesPF32 / 4) },
    },
  };
}

/**
 * Validates that the allocated SharedArrayBuffer exactly matches the
 * byte size calculated by the layout planner.
 */
function expectBackingMatchesPlan(spec: CanonicalSpec) {
  const plan = planLayout(spec);
  const backing = allocateShared(plan);

  expect(backing.kind).toBe("shared");
  expect(backing.sab).toBeInstanceOf(SharedArrayBuffer);
  expect(backing.sab.byteLength).toBe(plan.bytesTotal);

  return { plan, backing };
}

describe("Allocate Shared (Contiguous Layout)", () => {
  it("allocates a SAB matching the plan total exactly (small spec)", () => {
    expectBackingMatchesPlan(makeSpec(4, 4));
  });

  it("handles irregular non-zero plane sizes while preserving exact total bytes", () => {
    // 7 bytes for bools, 64 bytes for f32
    expectBackingMatchesPlan(makeSpec(7, 64));
  });

  it("allocates correctly at larger sizes (multi-page sanity check)", () => {
    expectBackingMatchesPlan(makeSpec(32 * 1024, 128 * 1024));
  });

  it("produces SAB sizes that grow monotonically with plane usage", () => {
    const smallSpec = makeSpec(4, 16);
    const midSpec = makeSpec(128, 4 * 1024);
    const largeSpec = makeSpec(4 * 1024, 64 * 1024);

    const smallPlan = planLayout(smallSpec);
    const midPlan = planLayout(midSpec);
    const largePlan = planLayout(largeSpec);

    expect(midPlan.bytesTotal).toBeGreaterThan(smallPlan.bytesTotal);
    expect(largePlan.bytesTotal).toBeGreaterThan(midPlan.bytesTotal);

    const smallBacking = allocateShared(smallPlan);
    const midBacking = allocateShared(midPlan);
    const largeBacking = allocateShared(largePlan);

    expect(smallBacking.sab.byteLength).toBe(smallPlan.bytesTotal);
    expect(midBacking.sab.byteLength).toBe(midPlan.bytesTotal);
    expect(largeBacking.sab.byteLength).toBe(largePlan.bytesTotal);
  });
});
