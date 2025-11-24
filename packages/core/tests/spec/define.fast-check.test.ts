import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { defineSpec } from "../../src/spec/define";

import type { MeterBuilders, ParamBuilders } from "../../src/spec/define";
import type { SpecInput } from "../../src/spec/types";

/**
 * Helper type representing the callback structure passed to defineSpec.
 * Uses 'unknown' for params/meters to allow flexibility in testing invalid structures.
 */
type SpecBuilder = (api: {
  readonly param: ParamBuilders;
  readonly meter: MeterBuilders;
}) => {
  id: string;
  params?: unknown;
  meters?: unknown;
};

/**
 * Wraps spec definition in a closure to verify runtime validation behavior.
 * Casts the builder output to `SpecInput` to bypass static type checking,
 * allowing us to intentionally feed invalid data to the runtime validator.
 */
function runSpec(builder: SpecBuilder): () => unknown {
  return () => defineSpec(builder as unknown as SpecInput);
}

describe("Scalar range validation (property-based)", () => {
  it("accepts finite f32 ranges with min < max", () => {
    const finiteFloats = fc.double({
      min: -1e6,
      max: 1e6,
      noNaN: true,
      noDefaultInfinity: true,
    });

    fc.assert(
      fc.property(finiteFloats, finiteFloats, (min, max) => {
        // Precondition: A valid range requires min < max
        fc.pre(min < max);

        const attemptDefine = runSpec(({ param }) => ({
          id: "f32-valid-full",
          params: {
            p: param.f32({ min, max }),
          },
        }));

        expect(attemptDefine).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("rejects inverted or flat f32 ranges (min >= max)", () => {
    const finiteFloats = fc.double({
      min: -1e6,
      max: 1e6,
      noNaN: true,
      noDefaultInfinity: true,
    });

    fc.assert(
      fc.property(finiteFloats, finiteFloats, (a, b) => {
        // Precondition: Invalid range cases
        fc.pre(a >= b);

        const attemptDefine = runSpec(({ param }) => ({
          id: "f32-invalid-inverted",
          params: {
            p: param.f32({ min: a, max: b }),
          },
          meters: {},
        }));

        expect(attemptDefine).toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("accepts partial f32 definitions specifying only a minimum bound", () => {
    const finiteFloats = fc.double({
      min: -1e9,
      max: 1e9,
      noNaN: true,
      noDefaultInfinity: true,
    });

    fc.assert(
      fc.property(finiteFloats, (min) => {
        const attemptDefine = runSpec(({ param }) => ({
          id: "f32-min-only",
          params: {
            p: param.f32({ min }),
          },
          meters: {},
        }));

        expect(attemptDefine).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("accepts partial f32 definitions specifying only a maximum bound", () => {
    const finiteFloats = fc.double({
      min: -1e9,
      max: 1e9,
      noNaN: true,
      noDefaultInfinity: true,
    });

    fc.assert(
      fc.property(finiteFloats, (max) => {
        const attemptDefine = runSpec(({ param }) => ({
          id: "f32-max-only",
          params: {
            p: param.f32({ max }),
          },
          meters: {},
        }));

        expect(attemptDefine).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("accepts completely unbounded f32 definitions (no range object provided)", () => {
    const attemptDefine = runSpec(({ param }) => ({
      id: "f32-unbounded",
      params: {
        p: param.f32(),
      },
      meters: {},
    }));

    expect(attemptDefine).not.toThrow();
  });

  it("rejects non-finite values (NaN, Infinity) used as range bounds", () => {
    const nonFiniteValues = fc.oneof(
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
    );

    const finiteFloats = fc.double({
      min: -1e3,
      max: 1e3,
      noNaN: true,
      noDefaultInfinity: true,
    });

    fc.assert(
      fc.property(nonFiniteValues, finiteFloats, (badValue, validValue) => {
        // We test multiple invalid configurations in one property run
        const testCases: readonly (() => unknown)[] = [
          // Invalid Min
          runSpec(({ param }) => ({
            id: "f32-bad-min",
            params: {
              p: param.f32({ min: badValue, max: validValue }),
            },
            meters: {},
          })),
          // Invalid Max
          runSpec(({ param }) => ({
            id: "f32-bad-max",
            params: {
              p: param.f32({ min: validValue, max: badValue }),
            },
            meters: {},
          })),
          // Invalid Min (Single)
          runSpec(({ param }) => ({
            id: "f32-bad-min-only",
            params: {
              p: param.f32({ min: badValue }),
            },
            meters: {},
          })),
          // Invalid Max (Single)
          runSpec(({ param }) => ({
            id: "f32-bad-max-only",
            params: {
              p: param.f32({ max: badValue }),
            },
            meters: {},
          })),
        ];

        for (const attemptDefine of testCases) {
          expect(attemptDefine).toThrow();
        }
      }),
      { numRuns: 200 },
    );
  });
});
