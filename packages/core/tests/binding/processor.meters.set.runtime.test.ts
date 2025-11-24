import { describe, expect, it } from "vitest";

import { defineSpec } from "../../src";
import { bindingsFromSpec } from "../helpers/binding";

describe("ProcessorMeters.set (Runtime)", () => {
  const spec = defineSpec(({ param, meter }) => ({
    id: "set-runtime",
    params: {
      gain: param.f32({ min: 0, max: 2 }),
    },
    meters: {
      peak: meter.f32(),
      count: meter.u32(),
      spectrum: meter.f32.array({ length: 8 }),
    },
  }));

  it("correctly commits scalar values via explicit set() calls", () => {
    const { ctl, proc } = bindingsFromSpec(spec);

    proc.meters.publish((writer) => {
      writer.set("peak", 0.5);
      writer.set("count", 42);
    });

    // Verify visibility on the controller side.
    // We snapshot specific keys to ensure the selective read path is exercised.
    const meters = ctl.meters.snapshot("peak", "count", "spectrum");

    expect(meters.peak).toBeCloseTo(0.5);
    expect(meters.count >>> 0).toBe(42);
  });

  it("enforces runtime validation for unknown meter keys", () => {
    const { proc } = bindingsFromSpec(spec);

    expect(() => {
      proc.meters.publish((w) => {
        // @ts-expect-error Testing runtime guard against invalid keys
        w.set("nope", 1);
      });
    }).toThrow(/unknown/i);
  });
});
