import { beforeEach, describe, expect, it } from "vitest";

import {
  incrementCounter,
  resetCounters,
  setCounter,
  snapshotCounters,
} from "../../src/diagnostics/counters";
import { isSeqlokError, type SeqlokError } from "../../src/errors/error";

describe("Diagnostics Counters: Runtime State & Validation", () => {
  beforeEach(() => {
    resetCounters();
  });

  it("increments counters correctly and returns independent snapshot copies", () => {
    incrementCounter("degradedSnapshots");
    incrementCounter("spinBudgetExhausted", 2);

    const snapshot1 = snapshotCounters();

    expect(snapshot1.degradedSnapshots).toBe(1);
    expect(snapshot1.spinBudgetExhausted).toBe(2);
    expect(snapshot1.retryBudgetExhausted).toBe(0);

    // Verify idempotency: Taking another snapshot without intervening writes returns identical state
    const snapshot2 = snapshotCounters();
    expect(snapshot2).toEqual(snapshot1);

    // Verify isolation: The internal state remains unaffected by external objects
    const distinctState = {
      degradedSnapshots: 999,
      spinBudgetExhausted: 999,
      retryBudgetExhausted: 999,
    };
    expect(snapshot2).not.toEqual(distinctState);
  });

  it("sets specific counter values explicitly via setCounter", () => {
    setCounter("retryBudgetExhausted", 10);

    const snapshot = snapshotCounters();
    expect(snapshot.retryBudgetExhausted).toBe(10);
    expect(snapshot.degradedSnapshots).toBe(0);
    expect(snapshot.spinBudgetExhausted).toBe(0);
  });

  it("resets all counters to zero via counters.reset()", () => {
    incrementCounter("degradedSnapshots", 3);
    setCounter("spinBudgetExhausted", 5);

    const snapshotBefore = snapshotCounters();
    expect(snapshotBefore.degradedSnapshots).toBe(3);
    expect(snapshotBefore.spinBudgetExhausted).toBe(5);

    resetCounters();

    const snapshotAfter = snapshotCounters();
    expect(snapshotAfter.degradedSnapshots).toBe(0);
    expect(snapshotAfter.spinBudgetExhausted).toBe(0);
    expect(snapshotAfter.retryBudgetExhausted).toBe(0);
  });

  it("throws diagnostics.counterInvalid when incrementing beyond the safe integer limit", () => {
    // Initialize to the maximum allowed safe integer to force an immediate overflow
    const maxSafe = Number.MAX_SAFE_INTEGER;
    setCounter("degradedSnapshots", maxSafe);

    let thrown: unknown;

    try {
      incrementCounter("degradedSnapshots", 1);
    } catch (error) {
      thrown = error;
    }

    if (!isSeqlokError(thrown)) {
      throw new Error("Expected a SeqlokError from incrementCounter overflow");
    }

    const err = thrown as SeqlokError<"diagnostics.counterInvalid">;

    expect(err.code).toBe("diagnostics.counterInvalid");
    expect(err.details.name).toBe("degradedSnapshots");
    expect(err.details.value).toBe(maxSafe + 1);
  });

  it("throws diagnostics.counterInvalid when attempting to set a negative value", () => {
    let thrown: unknown;

    try {
      // Counters are strictly non-negative
      setCounter("spinBudgetExhausted", -1);
    } catch (error) {
      thrown = error;
    }

    if (!isSeqlokError(thrown)) {
      throw new Error(
        "Expected a SeqlokError from setCounter with negative value",
      );
    }

    const err = thrown as SeqlokError<"diagnostics.counterInvalid">;

    expect(err.code).toBe("diagnostics.counterInvalid");
    expect(err.details.name).toBe("spinBudgetExhausted");
    expect(err.details.value).toBe(-1);
  });
});
