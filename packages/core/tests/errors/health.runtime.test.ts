import { describe, expect, it } from "vitest";

import {
  getDocsUrl,
  interpretHealth,
  isBoundarySafe,
  isRecoverable,
} from "../../src/errors/health";

import type { ErrorMeta } from "../../src/errors/registry";

/**
 * Helper factory to construct partial ErrorMeta objects for testing purposes.
 * Provides safe defaults for required fields.
 */
function meta(
  overrides: Partial<ErrorMeta> & { severity: ErrorMeta["severity"] },
): ErrorMeta {
  return {
    severity: overrides.severity,
    recoverable: overrides.recoverable ?? false,
    boundarySafe: overrides.boundarySafe ?? false,
    docsUrl: overrides.docsUrl,
    deprecated: overrides.deprecated,
  } as ErrorMeta;
}

describe("interpretHealth: Error Status Interpretation", () => {
  it("maps non-recoverable fatal errors to critical status with correct flags", () => {
    const m = meta({
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    });
    const h = interpretHealth(m);

    expect(h.status).toBe("fatal");
    expect(h.label).toBe("Critical");
    expect(h.recoverable).toBe(false);
    expect(h.boundarySafe).toBe(false);
    // Ensure a user-facing hint string is generated
    expect(typeof h.hint).toBe("string");
  });

  it("preserves recoverable flags even for fatal severity definitions", () => {
    const m = meta({
      severity: "fatal",
      recoverable: true,
      boundarySafe: false,
    });
    const h = interpretHealth(m);

    expect(h.recoverable).toBe(true);
    expect(h.boundarySafe).toBe(false);
  });

  it("distinguishes between standard errors, recoverable errors, and warnings", () => {
    const errRecoverable = interpretHealth(
      meta({ severity: "error", recoverable: true, boundarySafe: true }),
    );
    const errNonRecoverable = interpretHealth(
      meta({ severity: "error", recoverable: false, boundarySafe: false }),
    );
    const warn = interpretHealth(
      meta({ severity: "warning", recoverable: true, boundarySafe: true }),
    );

    expect(errRecoverable.status).toBe("error");
    expect(errNonRecoverable.status).toBe("error");
    expect(warn.status).toBe("warning");
    expect(typeof warn.hint).toBe("string");
  });

  it("delegates utility checks (isBoundarySafe, isRecoverable, getDocsUrl) directly to metadata", () => {
    const m: ErrorMeta = {
      severity: "warning",
      recoverable: true,
      boundarySafe: true,
      docsUrl: "https://example.test/docs",
    };

    expect(isBoundarySafe(m)).toBe(true);
    expect(isRecoverable(m)).toBe(true);
    expect(getDocsUrl(m)).toBe("https://example.test/docs");
  });
});
