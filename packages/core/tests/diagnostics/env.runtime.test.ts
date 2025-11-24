import { describe, expect, it } from "vitest";

import {
  assertSabSupportFromSummary,
  summarizeEnv,
  type EnvGlobal,
} from "../../src/diagnostics/env";
import { SeqlokError } from "../../src/errors/error";

describe("Environment Diagnostics & Compatibility", () => {
  it("correctly identifies a Node.js-like environment based on process globals", () => {
    // Mock a Node.js environment with SAB support
    const env = summarizeEnv({
      process: { versions: { node: "20.0.0" } },
      SharedArrayBuffer: (() =>
        undefined) as unknown as typeof SharedArrayBuffer,
    } as EnvGlobal);

    expect(env.kind).toBe("node");
    expect(env.hasSharedArrayBuffer).toBe(true);
    // Node environments typically do not rely on crossOriginIsolated for SABs
    expect(env.crossOriginIsolated).toBeUndefined();
  });

  it("identifies a browser main thread with active Cross-Origin Isolation and SharedArrayBuffer support", () => {
    // Mock a secured Browser environment
    const env = summarizeEnv({
      document: {},
      crossOriginIsolated: true,
      SharedArrayBuffer: (() =>
        undefined) as unknown as typeof SharedArrayBuffer,
    } as EnvGlobal);

    expect(env.kind).toBe("browser");
    expect(env.hasSharedArrayBuffer).toBe(true);
    expect(env.crossOriginIsolated).toBe(true);
  });

  it("throws env.unsupported when SharedArrayBuffer is completely absent from the global scope", () => {
    const summary = summarizeEnv({
      document: {},
      // Intentionally omitting SharedArrayBuffer
    } as EnvGlobal);

    expect(summary.kind).toBe("browser");
    expect(summary.hasSharedArrayBuffer).toBe(false);

    let thrown: unknown;
    try {
      assertSabSupportFromSummary("test.env.unsupported", summary);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SeqlokError);

    const err = thrown as SeqlokError<"env.unsupported">;
    expect(err.code).toBe("env.unsupported");
    expect(err.details.feature).toBe("SharedArrayBuffer");
    expect(err.details.where).toBe("test.env.unsupported");
  });

  it("throws env.coopCoepRequired in browsers when SharedArrayBuffer is present but Cross-Origin Isolation is inactive", () => {
    // Mock a browser environment where SAB constructor exists, but headers are missing (insecure context)
    const summary = summarizeEnv({
      document: {},
      crossOriginIsolated: false,
      SharedArrayBuffer: (() =>
        undefined) as unknown as typeof SharedArrayBuffer,
    } as EnvGlobal);

    expect(summary.kind).toBe("browser");
    expect(summary.hasSharedArrayBuffer).toBe(true);
    expect(summary.crossOriginIsolated).toBe(false);

    let thrown: unknown;
    try {
      assertSabSupportFromSummary("test.env.coop-coep", summary);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SeqlokError);

    const err = thrown as SeqlokError<"env.coopCoepRequired">;
    expect(err.code).toBe("env.coopCoepRequired");
    expect(err.details.context).toBe("browser");
    expect(err.details.where).toBe("test.env.coop-coep");
  });
});
