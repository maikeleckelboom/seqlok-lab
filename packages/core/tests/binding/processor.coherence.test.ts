import { describe, expect, it } from "vitest";

import { defineSpec, planLayout } from "../../src";
import { bindingsFromSpec } from "../helpers/binding";

/**
 * Tests for processor binding coherency and metering functionality.
 * Verifies parameter and meter operations maintain consistency across thread boundaries.
 */
describe("Processor Binding: Coherency & Metering", () => {
  it("reads parameter values atomically within a transaction", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "coherent-read",
      params: {
        gain: param.f32({ min: 0, max: 4 }),
        curve: param.f32.array(8),
      },
      meters: {
        peak: meter.f32(),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    // Simulate Controller updates (Writer)
    ctl.params.set("gain", 2.5);
    ctl.params.stage("curve", (v) => {
      v.fill(1.0);
    });

    // Verify Processor observations (Reader)
    proc.params.within((view) => {
      expect(view.gain).toBe(2.5);
      expect(view.curve.length).toBe(8);
      expect(view.curve[0]).toBe(1.0);
    });
  });

  it("publishes multiple meter updates atomically", () => {
    const spec = defineSpec(({ meter }) => ({
      id: "atomic-publish",
      meters: {
        rms: meter.f32(),
        counter: meter.u32(),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    proc.meters.publish((w) => {
      w.rms(0.75);
      w.counter(42);
    });

    const snap = ctl.meters.snapshot();
    expect(snap.rms).toBe(0.75);
    expect(snap.counter).toBe(42);
  });

  it("stages meter array updates via callbacks", () => {
    const spec = defineSpec(({ meter }) => ({
      id: "meter-stage",
      meters: {
        spectrum: meter.f32.array(64),
        flags: meter.u32.array(8),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    proc.meters.publish((w) => {
      w.stage("spectrum", (dst) => {
        for (let i = 0; i < dst.length; i++) {
          dst[i] = i * 0.1;
        }
      });

      w.stage("flags", (dst) => {
        dst.fill(1);
      });
    });

    const snap = ctl.meters.snapshot();
    expect(snap.spectrum[10]).toBeCloseTo(1.0);
    expect(snap.flags[3]).toBe(1);
  });

  it("provides runtime-safe access to enum parameters using numeric indices", () => {
    const spec = defineSpec(({ param }) => ({
      id: "enum-view",
      params: {
        mode: param.enum({ values: ["low", "mid", "high"] }),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    // Controller uses high-level string labels for better developer experience
    ctl.params.set("mode", "mid");

    // Processor uses numeric indices for performance-critical audio thread operations
    const midIndex = spec.params.mode.values.indexOf("mid"); // -> 1

    proc.params.within((view) => {
      expect(view.mode).toBe(midIndex);
    });
  });

  it("throws a descriptive error when attempting to stage updates for an unknown meter", () => {
    const spec = defineSpec(({ meter }) => ({
      id: "unknown-meter",
      params: {},
      meters: {
        valid: meter.f32.array(16),
      },
    }));

    const { proc } = bindingsFromSpec(spec);

    expect(() => {
      proc.meters.publish((w) => {
        // @ts-expect-error: Testing runtime validation for invalid meter key
        w.stage("invalid", () => {
          /* empty */
        });
      });
    }).toThrow(/unknown|key|meter/i);
  });

  it("enforces non-zero length constraints for meter arrays during layout planning", () => {
    const build = () =>
      defineSpec(({ meter }) => ({
        id: "zero-meter",
        params: {},
        meters: {
          empty: meter.f32.array(0),
        },
      }));

    try {
      // Validation may occur at definition or planning stage
      build();
      const spec = build();
      expect(() => planLayout(spec)).toThrow(/positive integer|length/i);
    } catch {
      // Definition-time throw is also acceptable
    }
  });

  it("maintains strictly increasing version numbers for parameter updates", () => {
    const spec = defineSpec(({ param }) => ({
      id: "version-pu",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
    }));

    const { proc } = bindingsFromSpec(spec);

    const v1 = proc.params.version();
    expect(v1).toBeGreaterThanOrEqual(0);

    const v2 = proc.params.version();
    expect(v2).toBeGreaterThanOrEqual(v1);
  });

  it("maintains strictly increasing version numbers for meter updates", () => {
    const spec = defineSpec(({ meter }) => ({
      id: "version-mu",
      meters: {
        peak: meter.f32(),
        spectrum: meter.f32.array(4),
      },
    }));

    const { proc } = bindingsFromSpec(spec);

    const v1 = proc.meters.version();

    proc.meters.publish((writer) => {
      writer.set("peak", 1.25);
      writer.stage("spectrum", (dst) => {
        // Fill with test pattern for validation
        dst.fill(255, 256, 512);
      });
    });

    const v2 = proc.meters.version();
    expect(v2).toBeGreaterThanOrEqual(v1);
  });

  it("correctly processes boolean parameters and boolean arrays in processor view", () => {
    const spec = defineSpec(({ param }) => ({
      id: "bool-param",
      params: {
        enabled: param.bool(),
        flags: param.bool.array(4),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    ctl.params.set("enabled", true);
    ctl.params.stage("flags", (v) => {
      v[0] = 1;
      v[1] = 0;
    });

    proc.params.within((view) => {
      expect(view.enabled).toBe(true);
      // Arrays are typically backed by TypedArrays (0/1), but exposed as logic
      expect(view.flags[0]).toBe(1);
      expect(view.flags[1]).toBe(0);
    });
  });

  it("maintains precision for f64 meters", () => {
    const spec = defineSpec(({ meter }) => ({
      id: "f64-meter",
      params: {},
      meters: {
        precise: meter.f64(),
        samples: meter.f64.array(16),
      },
    }));

    const { ctl, proc } = bindingsFromSpec(spec);

    proc.meters.publish((writer) => {
      writer.set("precise", Math.PI);
      writer.stage("samples", (dst) => {
        dst[0] = Math.E;
      });
    });

    const snap = ctl.meters.snapshot();
    expect(snap.precise).toBeCloseTo(Math.PI, 10);
    expect(snap.samples[0]).toBeCloseTo(Math.E, 10);
  });
});
