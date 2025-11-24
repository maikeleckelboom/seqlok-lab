/**
 * Integration test: environment detection → backing allocation.
 *
 * Verifies that:
 * - `assertSabSupportFromSummary` reports `env.unsupported` when SAB is unavailable.
 * - `allocateShared` also reports `env.unsupported` when SAB is unavailable.
 * - `allocateShared` succeeds when SAB is present.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { allocateShared } from "../../src/backing/allocate-shared";
import {
  assertSabSupportFromSummary,
  summarizeEnv,
  type EnvGlobal,
} from "../../src/diagnostics/env";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

import type { SeqlokError } from "../../src/errors/error";

describe("allocate-shared.env-guard", () => {
  let originalSharedArrayBuffer: typeof SharedArrayBuffer | undefined;

  beforeEach(() => {
    originalSharedArrayBuffer = (
      globalThis as { SharedArrayBuffer?: typeof SharedArrayBuffer }
    ).SharedArrayBuffer;
  });

  afterEach(() => {
    if (originalSharedArrayBuffer) {
      (
        globalThis as { SharedArrayBuffer?: typeof SharedArrayBuffer }
      ).SharedArrayBuffer = originalSharedArrayBuffer;
    } else {
      delete (globalThis as { SharedArrayBuffer?: typeof SharedArrayBuffer })
        .SharedArrayBuffer;
    }
  });

  it("assertSabSupportFromSummary fails gracefully when SAB is missing", () => {
    const fakeEnv = {
      kind: "browser" as const,
      hasSharedArrayBuffer: false,
      crossOriginIsolated: false,
    } as unknown as EnvGlobal;

    const summary = summarizeEnv(fakeEnv);

    expect(summary.hasSharedArrayBuffer).toBe(false);

    expect(() => {
      assertSabSupportFromSummary("allocate-shared.env-guard.test", summary);
    }).toThrow();

    try {
      assertSabSupportFromSummary("allocate-shared.env-guard.test", summary);
    } catch (error) {
      const seqlokError = error as SeqlokError<"env.unsupported">;
      expect(seqlokError.code).toBe("env.unsupported");
      expect(seqlokError.message).toContain("SharedArrayBuffer");
      expect(seqlokError.details).toBeDefined();
      expect(seqlokError.details).toHaveProperty(
        "where",
        "allocate-shared.env-guard.test",
      );
    }
  });

  it("throws env.unsupported when allocateShared is called without SharedArrayBuffer", () => {
    delete (globalThis as { SharedArrayBuffer?: typeof SharedArrayBuffer })
      .SharedArrayBuffer;

    const spec = defineSpec(({ param }) => ({
      id: "env-guard-test",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
      meters: {},
    }));

    const plan = planLayout(spec);

    expect(() => {
      allocateShared(plan);
    }).toThrow();

    try {
      allocateShared(plan);
    } catch (error) {
      const seqlokError = error as SeqlokError<"env.unsupported">;
      expect(seqlokError.code).toBe("env.unsupported");
      expect(seqlokError.message).toContain("SharedArrayBuffer");
      expect(seqlokError.details).toBeDefined();
      expect(seqlokError.details).toHaveProperty(
        "feature",
        "SharedArrayBuffer",
      );
      if ("reason" in seqlokError.details) {
        expect(seqlokError.details.reason).not.toHaveLength(0);
      }
    }
  });

  it("succeeds when SharedArrayBuffer is available", () => {
    const spec = defineSpec(({ param }) => ({
      id: "env-guard-success",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
      meters: {},
    }));

    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    expect(backing).toBeDefined();
    expect(backing.kind).toBe("shared");
    expect(backing.sab).toBeInstanceOf(SharedArrayBuffer);
    expect(backing.sab.byteLength).toBeGreaterThan(0);
  });

  it("detects missing SAB even if host forgets to call assertSabSupport", () => {
    delete (globalThis as { SharedArrayBuffer?: typeof SharedArrayBuffer })
      .SharedArrayBuffer;

    const spec = defineSpec(({ param }) => ({
      id: "env-guard-missing-sab",
      params: {
        gain: param.f32({ min: 0, max: 1 }),
      },
      meters: {},
    }));

    const plan = planLayout(spec);

    expect(() => {
      allocateShared(plan);
    }).toThrow();

    try {
      allocateShared(plan);
    } catch (error) {
      const seqlokError = error as SeqlokError<"env.unsupported">;
      expect(seqlokError.code).toBe("env.unsupported");
      expect(seqlokError.details).toBeDefined();
      expect(seqlokError.details).toHaveProperty(
        "feature",
        "SharedArrayBuffer",
      );
      if ("reason" in seqlokError.details) {
        expect(seqlokError.details.reason).not.toHaveLength(0);
      }
      expect(seqlokError.message).toBeDefined();
    }
  });
});
