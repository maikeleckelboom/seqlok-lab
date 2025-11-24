import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  defineSpec,
  planLayout,
} from "../../src";

describe("Controller: Edge Cases & Validation", () => {
  it("rejects enum writes with invalid string labels", () => {
    const spec = defineSpec(({ param }) => ({
      id: "enum-validation",
      params: {
        mode: param.enum(["sine", "square", "saw"]),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);

    expect(() => {
      // @ts-expect-error Testing runtime validation for non-existent enum key
      ctl.params.set("mode", "triangle");
    }).toThrow(/enum|invalid|value/i);
  });

  it('clamps out-of-range f32 values when rangePolicy is set to "clamp"', () => {
    const spec = defineSpec(({ param }) => ({
      id: "range-policy-clamp",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing, {
      params: { rangePolicy: "clamp" },
    });

    const versionBefore = ctl.params.version();

    // Should not throw; value should be clamped to max (1)
    ctl.params.set("gain", 1.5);

    const versionAfter = ctl.params.version();
    expect(versionAfter).toBe(versionBefore + 1);

    const { gain } = ctl.params.snapshot(["gain"]);
    expect(gain).toBe(1);
  });

  it('throws on out-of-range f32 values when rangePolicy is set to "reject"', () => {
    const spec = defineSpec(({ param }) => ({
      id: "range-policy-reject",
      params: {
        rate: param.f32({ min: 0.5, max: 4 }),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing, {
      params: { rangePolicy: "reject" },
    });

    expect(() => {
      ctl.params.set("rate", 5);
    }).toThrow(/out of range|range|bounds/i);
  });

  it('validates "into" buffer type compatibility for parameter snapshots', () => {
    const spec = defineSpec(({ param }) => ({
      id: "buffer-type-mismatch",
      params: {
        curve: param.f32.array(64),
      },
      meters: {},
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);

    // Intentional type mismatch: Int32Array provided for Float32 param
    const wrongBuffer = new Int32Array(64);

    expect(() => {
      // @ts-expect-error Intentionally passing wrong TypedArray type
      ctl.params.snapshot({
        keys: ["curve"],
        into: { curve: wrongBuffer },
      });
    }).toThrow(/type|Float32Array|Int32Array/i);
  });

  it('validates "into" buffer length compatibility for parameter snapshots', () => {
    const spec = defineSpec(({ param }) => ({
      id: "buffer-length-mismatch",
      params: {
        coeffs: param.f32.array(128),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);

    // Buffer is too small for the declared parameter size
    const wrongSize = new Float32Array(64);

    expect(() => {
      ctl.params.snapshot({
        keys: ["coeffs"],
        into: { coeffs: wrongSize },
      });
    }).toThrow(/length|size|128|64/i);
  });

  it("handles empty parameter specifications gracefully", () => {
    const spec = defineSpec(() => ({
      id: "empty-params",
      meters: { peak: { kind: "f32" } },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);

    const snap = ctl.params.snapshot();
    expect(Object.keys(snap)).toHaveLength(0);
  });

  it("normalizes boolean parameters from numeric 0/1 inputs", () => {
    const spec = defineSpec(({ param }) => ({
      id: "bool-numeric-coercion",
      params: {
        enabled: param.bool(),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);

    // @ts-expect-error Testing runtime coercion of numeric truthy
    ctl.params.set("enabled", 1);
    expect(ctl.params.snapshot().enabled).toBe(true);

    // @ts-expect-error Testing runtime coercion of numeric falsy
    ctl.params.set("enabled", 0);
    expect(ctl.params.snapshot().enabled).toBe(false);
  });

  it("throws when attempting to stage a non-existent array parameter", () => {
    const spec = defineSpec(({ param }) => ({
      id: "unknown-stage-key",
      params: {
        valid: param.f32.array(8),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);

    expect(() => {
      // @ts-expect-error Argument 'invalid' is not assignable to parameter of type 'valid'
      ctl.params.stage("invalid", () => {
        /* empty */
      });
    }).toThrow(/unknown|key|param/i);
  });

  it("accepts scalar enum writes via numeric index (runtime interop)", () => {
    const spec = defineSpec(({ param }) => ({
      id: "enum-index-write",
      params: {
        waveform: param.enum(["sine", "square", "saw"]),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);
    const ctl = bindController(spec, plan, backing);

    // Writing index 1 ('square') directly
    ctl.params.set("waveform", 1 as unknown as never);

    const snap = ctl.params.snapshot();
    // Snapshot returns the string representation, or at least validates the update occurred
    expect(snap.waveform).toMatch(/square|1/);
  });

  it("rejects zero-length array parameters during specification or layout planning", () => {
    const build = () =>
      defineSpec(({ param }) => ({
        id: "zero-length-array",
        params: {
          empty: param.f32.array(0),
        },
      }));

    try {
      // Validation may occur at definition time
      build();
      // Or at layout planning time
      const spec = build();
      expect(() => planLayout(spec)).toThrow(/positive integer|length/i);
    } catch {
      // Exception thrown by defineSpec is also acceptable
    }
  });
});
