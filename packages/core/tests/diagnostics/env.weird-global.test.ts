/**
 * Env helpers are defensive against structural weirdness (missing/incorrect types),
 * but they do not attempt to sandbox or neutralize host-level exceptions.
 * Caller is responsible for handling hostile globals that throw on property access.
 *
 * This suite exercises summarizeEnv/assertSabSupportFromSummary against a range
 * of weird pseudo-globals to prove those guarantees.
 */

import { describe, it, expect } from "vitest";

import {
  assertSabSupportFromSummary,
  type EnvGlobal,
  summarizeEnv,
} from "../../src/diagnostics/env";

import type { SeqlokError } from "../../src/errors/error";

describe("env.weird-global", () => {
  it("classifies weird object with no standard globals as unknown", () => {
    // Deliberately weird object: no window, self, process, or standard properties
    const weirdGlobal = {
      someRandomProperty: "foo",
      anotherWeirdThing: 42,
      nestedObject: {
        deep: {
          value: "bar",
        },
      },
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(weirdGlobal);

    expect(summary.kind).toBe("unknown");
    expect(summary.hasSharedArrayBuffer).toBe(false);
  });

  it("does not crash when global has unexpected types for known properties", () => {
    const weirdGlobal = {
      window: 123,
      self: "not-a-worker",
      process: { version: 1 },
      SharedArrayBuffer: null,
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(weirdGlobal);

    expect(summary.kind).toBe("unknown");
    expect(summary.hasSharedArrayBuffer).toBe(false);
  });

  it("assertSabSupportFromSummary throws env.unsupported for weird env without SAB", () => {
    const weirdGlobal = {
      random: true,
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(weirdGlobal);

    expect(summary.hasSharedArrayBuffer).toBe(false);

    expect(() => {
      assertSabSupportFromSummary("weird-global.test", summary);
    }).toThrow();

    try {
      assertSabSupportFromSummary("weird-global.test", summary);
    } catch (error) {
      const seqlokError = error as SeqlokError<"env.unsupported">;
      expect(seqlokError.code).toBe("env.unsupported");
      expect(seqlokError.message).toContain("SharedArrayBuffer");
      expect(seqlokError.details).toBeDefined();
      expect(seqlokError.details).toHaveProperty("where", "weird-global.test");
    }
  });

  it("handles object with SharedArrayBuffer but no other standard globals", () => {
    // Weird hybrid: has SAB but nothing else standard
    const hybridGlobal = {
      SharedArrayBuffer: SharedArrayBuffer,
      weirdField: "test",
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(hybridGlobal);

    // Should detect SAB presence
    expect(summary.hasSharedArrayBuffer).toBe(true);
    // But may still classify as unknown depending on implementation
    expect(summary.kind).toBeDefined();
  });

  it("handles object with null/undefined values", () => {
    const nullishGlobal = {
      window: null,
      self: undefined,
      process: null,
      SharedArrayBuffer: undefined,
      randomKey: "value",
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(nullishGlobal);

    expect(summary.kind).toBe("unknown");
    expect(summary.hasSharedArrayBuffer).toBe(false);
  });

  it("does not surface generic TypeError for extremely weird objects", () => {
    // Hostile global: property access itself throws
    const veryWeirdGlobal = {
      get SharedArrayBuffer() {
        throw new Error("access denied");
      },
      get window() {
        throw new Error("access denied");
      },
      get self() {
        throw new Error("access denied");
      },
      get process() {
        throw new Error("access denied");
      },
    };

    let thrown: unknown;

    try {
      // We intentionally do NOT expect summarizeEnv to fully handle this.
      // We only care that *if* something escapes, it is not a TypeError
      // caused by our own unsafe assumptions.
      summarizeEnv(veryWeirdGlobal as unknown as EnvGlobal);
    } catch (error) {
      thrown = error;
    }

    // If nothing was thrown, that's fine.
    if (thrown !== undefined) {
      expect(thrown).toBeInstanceOf(Error);
      // Important bit: this should not be a generic TypeError coming
      // from our own property usage (e.g. reading off `undefined`).
      expect(thrown).not.toBeInstanceOf(TypeError);
    }
  });

  it("detects missing SAB even in partially standard environments", () => {
    // Has some standard properties but no SAB
    const partialGlobal = {
      console: console,
      Object: Object,
      Array: Array,
      // No SharedArrayBuffer
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(partialGlobal);

    expect(summary.hasSharedArrayBuffer).toBe(false);

    expect(() => {
      assertSabSupportFromSummary("partial-global.test", summary);
    }).toThrow();

    try {
      assertSabSupportFromSummary("partial-global.test", summary);
    } catch (error) {
      const seqlokError = error as SeqlokError<"env.unsupported">;
      expect(seqlokError.code).toBe("env.unsupported");
    }
  });

  it("handles deeply nested weird structures without crashing", () => {
    const deeplyWeird = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: "deep",
            },
          },
        },
      },
      totallyUnrelated: true,
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(deeplyWeird);

    expect(summary.kind).toBe("unknown");
    expect(summary.hasSharedArrayBuffer).toBe(false);
  });

  it("correctly identifies when SAB is present but inaccessible", () => {
    // SAB property exists but is not the real constructor
    const fakeGlobal = {
      SharedArrayBuffer: "not-a-constructor",
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(fakeGlobal);

    // Should detect this is not actually a usable SharedArrayBuffer
    expect(summary.hasSharedArrayBuffer).toBe(false);

    expect(() => {
      assertSabSupportFromSummary("fake-sab.test", summary);
    }).toThrow();
  });
});
