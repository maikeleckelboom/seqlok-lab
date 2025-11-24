import { describe, expect, it } from "vitest";

import {
  ERROR_MESSAGES,
  ERROR_META,
  type ErrorCode,
  type ErrorMeta,
  getErrorMessage,
  getErrorMeta,
  isErrorCode,
} from "../../src/errors/registry";

/**
 * Minimal test case descriptor for validating semantic contracts of error codes.
 * Structural invariants cover the full registry; these cases pin specific
 * expectations for selected codes where semantics are critical to system stability.
 */
interface ErrorRegistryCase<C extends ErrorCode> {
  readonly code: C;
  readonly expectedMeta: Pick<
    ErrorMeta,
    "severity" | "recoverable" | "boundarySafe"
  >;
  readonly messageIncludes?: string | RegExp;
}

/**
 * Curated list of semantic anchor cases.
 *
 * These represent error codes where severity, recoverability, and boundary safety
 * are part of the public design contract. Modifications to these definitions
 * should be deliberate and reflected here.
 */
const CASES: readonly ErrorRegistryCase<ErrorCode>[] = [
  {
    code: "env.unsupported",
    expectedMeta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: true,
    },
    messageIncludes: /Required env feature unavailable/i,
  },
  {
    code: "env.coopCoepRequired",
    expectedMeta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
    messageIncludes: /COOP\/COEP headers required/i,
  },
  {
    code: "backing.wasmMemoryNotShared",
    expectedMeta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
    messageIncludes: /WebAssembly\.Memory.*not shared/i,
  },
  {
    code: "binding.snapshotIntoTypeMismatch",
    expectedMeta: {
      severity: "error",
      recoverable: true,
      boundarySafe: false,
    },
    messageIncludes: /typed array mismatch/i,
  },
  {
    code: "binding.snapshotRetryExhausted",
    expectedMeta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    },
    messageIncludes: /Snapshot retries exhausted/i,
  },
  {
    code: "plan.overflowRisk",
    expectedMeta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: true,
    },
    messageIncludes: /soft limit/i,
  },
  {
    code: "spec.builderInvalid",
    expectedMeta: {
      severity: "error",
      recoverable: false,
      boundarySafe: false,
    },
    messageIncludes: /Spec builder validation failed/i,
  },
  {
    code: "internal.unreachable",
    expectedMeta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
    messageIncludes: /Unreachable code executed/i,
  },
  {
    code: "diagnostics.counterInvalid",
    expectedMeta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    },
    messageIncludes: /Diagnostics counter invalid/i,
  },
  {
    code: "diagnostics.featureInvalid",
    expectedMeta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    },
    messageIncludes: /Diagnostics feature invalid/i,
  },
  {
    code: "plan.failed",
    expectedMeta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
    messageIncludes: /plan/i,
  },
  {
    code: "primitives.atomicsFailed",
    expectedMeta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
    messageIncludes: /atomics/i,
  },
];

/**
 * Retrieves all error codes currently defined in the runtime registry.
 * Used to iterate over the entire error surface for invariant checking.
 */
function getAllCodes(): ErrorCode[] {
  return Object.keys(ERROR_META) as ErrorCode[];
}

describe("Error Registry: Structural Invariants", () => {
  it("maintains strict key parity between metadata and message registries", () => {
    const codesFromMeta = Object.keys(ERROR_META).sort();
    const codesFromMessages = Object.keys(ERROR_MESSAGES).sort();

    expect(codesFromMeta).toEqual(codesFromMessages);
  });

  it("ensures all registered error codes are unique", () => {
    const allCodes = getAllCodes();
    const unique = new Set(allCodes);

    expect(unique.size).toBe(allCodes.length);
  });

  it("defines valid metadata and messages for every registered entry", () => {
    const allCodes = getAllCodes();

    for (const code of allCodes) {
      const meta = ERROR_META[code];
      const msg = ERROR_MESSAGES[code];

      expect(meta).toBeDefined();
      expect(typeof meta.severity).toBe("string");
      expect(typeof meta.recoverable).toBe("boolean");
      expect(typeof meta.boundarySafe).toBe("boolean");

      expect(msg).toBeDefined();
      expect(typeof msg).toBe("string");
    }
  });

  it("synchronizes lookup helpers and type guards with the registry content", () => {
    const allCodes = getAllCodes();

    for (const code of allCodes) {
      expect(isErrorCode(code)).toBe(true);
      expect(getErrorMeta(code)).toBe(ERROR_META[code]);
      expect(getErrorMessage(code)).toBe(ERROR_MESSAGES[code]);
    }

    // Negative cases: Validate that arbitrary strings are rejected
    const invalidSamples: readonly string[] = [
      "nope.not.a.code",
      "binding.unknown_code",
      "",
      "env",
      "layout",
    ];

    for (const candidate of invalidSamples) {
      expect(isErrorCode(candidate)).toBe(false);
    }
  });
});

describe("Error Registry: Semantic Contracts (Selected Codes)", () => {
  it.each(CASES)("validates semantic contract for $code", (testCase) => {
    const { code, expectedMeta, messageIncludes } = testCase;

    const meta = getErrorMeta(code);
    expect(meta.severity).toBe(expectedMeta.severity);
    expect(meta.recoverable).toBe(expectedMeta.recoverable);
    expect(meta.boundarySafe).toBe(expectedMeta.boundarySafe);

    if (messageIncludes !== undefined) {
      const msg = getErrorMessage(code);
      if (typeof messageIncludes === "string") {
        expect(msg).toContain(messageIncludes);
      } else {
        expect(msg).toMatch(messageIncludes);
      }
    }
  });
});

describe("Error Registry: Domain-Level Policy Enforcement", () => {
  it("enforces fatal/non-recoverable status for internal system errors (internal.*)", () => {
    for (const code of getAllCodes()) {
      if (code.startsWith("internal.")) {
        const meta = getErrorMeta(code);
        expect(meta.severity).toBe("fatal");
        expect(meta.recoverable).toBe(false);
        expect(meta.boundarySafe).toBe(false);
      }
    }
  });

  it("marks author-time specification errors as non-recoverable (spec.*)", () => {
    for (const code of getAllCodes()) {
      if (code.startsWith("spec.")) {
        const meta = getErrorMeta(code);
        expect(meta.recoverable).toBe(false);
      }
    }
  });

  it("classifies diagnostic errors as recoverable warnings (diagnostics.*)", () => {
    for (const code of getAllCodes()) {
      if (code.startsWith("diagnostics.")) {
        const meta = getErrorMeta(code);
        expect(meta.severity).toBe("warning");
        expect(meta.recoverable).toBe(true);
        expect(meta.boundarySafe).toBe(false);
      }
    }
  });

  it("permits boundary exposure for environment setup errors (env.*)", () => {
    for (const code of getAllCodes()) {
      if (code.startsWith("env.")) {
        const meta = getErrorMeta(code);
        expect(meta.boundarySafe).toBe(true);
      }
    }
  });

  it("restricts boundary exposure for transient binding failures (snapshot/retry)", () => {
    for (const code of getAllCodes()) {
      if (
        code.startsWith("binding.snapshotInto") ||
        code === "binding.snapshotRetryExhausted" ||
        code === "binding.coherentRetryExhausted"
      ) {
        const meta = getErrorMeta(code);
        expect(meta.boundarySafe).toBe(false);
      }
    }
  });

  it("enforces strict failure contract for handoff mechanisms (handoff.*)", () => {
    for (const code of getAllCodes()) {
      if (code.startsWith("handoff.")) {
        const meta = getErrorMeta(code);
        expect(meta.severity).toBe("error");
        expect(meta.recoverable).toBe(false);
        expect(meta.boundarySafe).toBe(true);
      }
    }
  });
});
