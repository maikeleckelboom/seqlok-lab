import { afterEach, describe, expect, it, vi } from "vitest";

import { snapshotWithPolicy } from "../../src/binding/common/coherent";
import * as counters from "../../src/diagnostics/counters";
import { isSeqlokError, type SeqlokError } from "../../src/errors/error";
import * as seqlock from "../../src/primitives/seqlock";

import type { SeqPair } from "../../src/primitives/seqlock";

describe("Snapshot With Policy: Coherent Snapshot & Fallback Strategies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Minimal SeqPair stub for testing policy wrappers
  const pair: SeqPair = {
    u32: new Uint32Array(2),
    lockIndex: 0,
    seqIndex: 1,
  };

  it("returns the reader value on success without triggering diagnostics", () => {
    const tryReadSpy = vi.spyOn(seqlock, "tryRead");

    tryReadSpy.mockImplementation((_pair, reader) => ({
      ok: true as const,
      value: reader(),
      status: {
        spins: 0,
        retries: 0,
        kind: "ok",
      },
    }));

    const countersSpy = vi.spyOn(counters, "incrementCounter");

    const value = snapshotWithPolicy(
      pair,
      {
        where: "controller.meters.snapshot",
        section: "meters",
        spinBudget: 4,
        retryBudget: 2,
        degrade: "returnLatest",
      },
      () => 42,
      () => {
        throw new Error("Fallback reader should not be invoked on success");
      },
    );

    expect(value).toBe(42);
    expect(tryReadSpy).toHaveBeenCalledTimes(1);
    expect(countersSpy).not.toHaveBeenCalled();
  });

  it('degrades to the fallback reader and records diagnostics under "returnLatest"', () => {
    const tryReadSpy = vi.spyOn(seqlock, "tryRead");

    // Simulate a failed read where budgets were fully consumed
    tryReadSpy.mockImplementation((_pair, _reader) => ({
      ok: false as const,
      value: 0, // Ignored on failure
      status: {
        spins: 5,
        retries: 3,
        kind: "budgetExhausted",
      },
    }));

    const countersSpy = vi.spyOn(counters, "incrementCounter");
    const degradedValue = 1337;

    const result = snapshotWithPolicy(
      pair,
      {
        where: "controller.meters.snapshot",
        section: "meters",
        spinBudget: 4,
        retryBudget: 2,
        degrade: "returnLatest",
      },
      () => {
        throw new Error("Primary reader should not be used when tryRead fails");
      },
      () => degradedValue,
    );

    // Verify fallback value is returned
    expect(result).toBe(degradedValue);

    // Verify diagnostic counters are incremented for visibility
    expect(countersSpy).toHaveBeenCalledTimes(3);
    const counterNames = countersSpy.mock.calls.map((call) => call[0]);
    expect(counterNames).toContain("spinBudgetExhausted");
    expect(counterNames).toContain("retryBudgetExhausted");
    expect(counterNames).toContain("degradedSnapshots");

    expect(tryReadSpy).toHaveBeenCalledTimes(1);
  });

  it("throws binding.snapshotRetryExhausted when retries are exhausted without degradation policy", () => {
    const tryReadSpy = vi.spyOn(seqlock, "tryRead");

    tryReadSpy.mockImplementation((_pair, _reader) => ({
      ok: false as const,
      value: 0,
      status: {
        spins: 1,
        retries: 0,
        kind: "budgetExhausted",
      },
    }));

    const countersSpy = vi.spyOn(counters, "incrementCounter");
    let thrown: unknown;

    try {
      snapshotWithPolicy(
        pair,
        {
          where: "controller.meters.snapshot",
          section: "meters",
          spinBudget: 1,
          retryBudget: 2,
          // No degrade policy provided
        },
        () => {
          throw new Error(
            "Primary reader should not be used when tryRead fails",
          );
        },
        () => {
          throw new Error(
            "Fallback should not be called without degrade policy",
          );
        },
      );
    } catch (error) {
      thrown = error;
    }

    // Diagnostics should still record the specific exhaustion event
    expect(countersSpy).toHaveBeenCalledTimes(1);
    expect(countersSpy).toHaveBeenCalledWith("spinBudgetExhausted");

    // Verify error structure
    if (!isSeqlokError(thrown)) {
      throw new Error("Expected snapshotWithPolicy to throw a SeqlokError");
    }

    const err = thrown as SeqlokError<"binding.snapshotRetryExhausted">;
    expect(err.code).toBe("binding.snapshotRetryExhausted");
    expect(err.details.where).toBe("controller.meters.snapshot");
    expect(err.details.section).toBe("meters");

    expect(err.details.spins ?? 0).toBeGreaterThanOrEqual(0);
    expect(err.details.retries ?? 0).toBeGreaterThanOrEqual(0);

    expect(tryReadSpy).toHaveBeenCalledTimes(1);
  });
});
