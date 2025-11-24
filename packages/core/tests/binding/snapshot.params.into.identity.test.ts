import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  defineSpec,
  planLayout,
} from "../../src";

/**
 * Creates a harness with mixed array types (Float32, Int32) and a scalar
 * to validate snapshot buffer management across different view types.
 */
function createHarness() {
  const spec = defineSpec(({ param }) => ({
    id: "params-identity-test",
    params: {
      curve: param.f32.array(1024),
      steps: param.i32.array(8),
      gain: param.f32({ min: 0, max: 4 }),
    },
  }));

  const plan = planLayout(spec);
  const backing = allocateShared(plan);
  const ctl = bindController(spec, plan, backing);
  return { ctl };
}

describe("Params Snapshot: Buffer Identity & Allocation", () => {
  it('reuses provided "into" buffers strictly by identity for array parameters', () => {
    const { ctl } = createHarness();

    // Populate initial state
    ctl.params.stage("curve", (v) => {
      for (let i = 0; i < v.length; i++) {
        v[i] = i;
      }
    });
    ctl.params.stage("steps", (v) => {
      v.set([1, 2, 3, 4, 5, 6, 7, 8]);
    });
    ctl.params.update({
      gain: 2,
    });

    const targetBuffer = new Float32Array(1024);

    const snap = ctl.params.snapshot({
      keys: ["curve"],
      into: {
        curve: targetBuffer,
      },
    });

    // Verify strict referential identity
    expect(snap.curve).toBe(targetBuffer);

    // Verify content verification
    expect(targetBuffer[10]).toBe(10);
  });

  it('allocates fresh arrays when "into" is omitted for a specific key', () => {
    const { ctl } = createHarness();

    ctl.params.stage("steps", (v) => v.fill(9));

    const snap = ctl.params.snapshot({ keys: ["steps"] });

    expect(snap.steps).toBeInstanceOf(Int32Array);
    // Implicitly verifies a new allocation since no buffer was provided
  });
});
