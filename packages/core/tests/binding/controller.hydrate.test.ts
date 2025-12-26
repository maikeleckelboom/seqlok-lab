// File: tests/binding/controller.hydrate.test.ts

import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  defineSpec,
  planLayout,
} from "../../src";

describe("Controller: Hydrate Validation", () => {
  const spec = defineSpec({
    id: "hydrate-hardening",
    params: {
      arr: { kind: "f32.array", length: 4 },
      val: { kind: "f32", min: 0, max: 1 },
    },
  });

  const plan = planLayout(spec);

  it("validates hydrate inputs rigorously against spec mismatch", () => {
    const backing = allocateShared(plan);
    const ctrl = bindController(spec, plan, backing);

    // 1. Unknown key check
    expect(() => {
      // @ts-expect-error: runtime validation should reject unknown keys
      ctrl.params.hydrate({ unknownKey: 123 });
    }).toThrow();

    // 2. Invalid array length check (Runtime vs Spec)
    expect(() => {
      ctrl.params.hydrate({ arr: new Float32Array(2) }); // Expected 4
    }).toThrow();

    // 3. Invalid type check (Scalar passed where Array expected)
    expect(() => {
      // @ts-expect-error: runtime validation should reject scalar for array param
      ctrl.params.hydrate({ arr: 123 });
    }).toThrow();

    // 4. Invalid type check (Array passed where Scalar expected)
    expect(() => {
      // @ts-expect-error: runtime validation should reject array for scalar param
      ctrl.params.hydrate({ val: new Float32Array(1) });
    }).toThrow();
  });
});
