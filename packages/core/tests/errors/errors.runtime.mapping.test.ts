import { describe, expect, it } from "vitest";

import { createError } from "../../src/errors/error";

interface DetailShape {
  readonly detail: string;
}

interface FeatureReasonShape {
  readonly feature: string;
  readonly reason: string;
}

/**
 * Type assertion helper: verifies that the details object contains a string `detail` field.
 * Narrows the type for subsequent property access.
 */
function expectHasDetail(details: unknown): asserts details is DetailShape {
  expect(details, "details must not be null/undefined").not.toBeNull();
  expect(typeof details, "details must be an object").toBe("object");

  const rec = details as Record<string, unknown>;
  expect(typeof rec.detail, "details.detail must be a string").toBe("string");
}

/**
 * Type assertion helper: verifies that the details object contains `feature` and `reason` fields.
 */
function expectHasFeatureReason(
  details: unknown,
): asserts details is FeatureReasonShape {
  expect(details, "details must not be null/undefined").not.toBeNull();
  expect(typeof details, "details must be an object").toBe("object");

  const rec = details as Record<string, unknown>;
  expect(typeof rec.feature, "details.feature must be a string").toBe("string");
  expect(typeof rec.reason, "details.reason must be a string").toBe("string");
}

describe("SeqlokError Factory: Runtime Composition", () => {
  it("composes error objects with structured details and preserves underlying causes", () => {
    // Simulate an upstream system error to verify cause preservation
    const cause = new TypeError("shared memory not supported");

    const err = createError(
      "backing.wasmMemoryNotShared",
      "Allocated WebAssembly.Memory is not shared",
      {
        detail: "memory.buffer is not a SharedArrayBuffer",
        plane: "wasm",
        shared: false,
      },
      cause,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("backing.wasmMemoryNotShared");

    // Verify human-readable message formatting
    expect(err.message).toMatch(/not shared/i);

    // Verify structured details payload
    expectHasDetail(err.details);
    expect(err.details.detail).toMatch(/SharedArrayBuffer/i);

    // Verify the original cause is attached verbatim
    expect(err.cause).toBe(cause);
  });

  it("constructs environment errors with specific feature and reason schemas", () => {
    const err = createError("env.unsupported", "Feature unavailable", {
      feature: "SharedArrayBuffer",
      reason: "Missing COOP/COEP",
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("env.unsupported");

    // Verify message stability
    expect(err.message).toMatch(/Feature unavailable/i);

    // Verify schema-specific details via type guard
    expectHasFeatureReason(err.details);
    expect(err.details.feature).toBe("SharedArrayBuffer");
    expect(err.details.reason).toMatch(/COOP\/COEP/i);
  });
});
