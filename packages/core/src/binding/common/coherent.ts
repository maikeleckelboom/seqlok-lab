/**
 * @fileoverview
 * Coherent read helpers for seqlock-protected parameter snapshots.
 *
 * @remarks
 * - Provides `makeWithin` to implement `params.within(...)` on the processor.
 * - Encodes retry/spin budgets and degrade policies for read-side callers.
 * - Used by bindings to obtain coherent views without exposing raw seqlocks.
 *
 * @internal
 */

import { incrementCounter } from "../../diagnostics/counters";
import { createError } from "../../errors/error";
import { tryRead, type SeqPair } from "../../primitives/seqlock";

import type { MeterDegradePolicy } from "./types";
import type {
  CoherentDetails,
  SnapshotRetryDetails,
} from "../../errors/details";

/**
 * Configuration for a seqlock-protected read.
 */
export interface CoherentReadOptions {
  readonly where: string;
  readonly spinBudget: number;
  readonly retryBudget: number;
}

/**
 * Extended options for snapshots (adds degradation policy).
 */
export interface SnapshotPolicyOptions extends CoherentReadOptions {
  readonly section: "params" | "meters";
  readonly degrade?: MeterDegradePolicy;
}

interface SnapshotStatus {
  readonly spins: number;
  readonly retries: number;
}

/**
 * Internal: run a snapshot reader under seqlock with optional degrade policy.
 *
 * - Uses primitives `tryRead`.
 * - Emits diagnostics counters on spin / retry exhaustion.
 * - On failure:
 * - if `degrade` is `'returnLatest'`, falls back to `degradedReader`.
 * - otherwise throws `binding.snapshotRetryExhausted`.
 */
export function snapshotWithPolicy<T>(
  pair: SeqPair,
  options: SnapshotPolicyOptions,
  reader: () => T,
  degradedReader: () => T,
): T {
  const { spinBudget, retryBudget, where, section, degrade } = options;

  const result = tryRead(pair, reader, { spinBudget, retryBudget });

  if (result.ok) {
    return result.value;
  }

  const status: SnapshotStatus = result.status;

  if (status.spins >= spinBudget) {
    incrementCounter("spinBudgetExhausted");
  }
  if (status.retries >= retryBudget) {
    incrementCounter("retryBudgetExhausted");
  }

  if (degrade === "returnLatest") {
    incrementCounter("degradedSnapshots");
    return degradedReader();
  }

  throw createError(
    "binding.snapshotRetryExhausted",
    "Snapshot retries exhausted",
    {
      where,
      section,
      spins: status.spins,
      retries: status.retries,
    } satisfies SnapshotRetryDetails,
  );
}

/**
 * @Internal: processor-side coherent read helper.
 *
 * - Wraps a raw reader in the PU seqlock protocol.
 * - No degrade path: coherence is mandatory on the processor.
 * - Throws `binding.coherentRetryExhausted` on failure.
 */
export function makeWithin<T>(
  pair: SeqPair,
  options: CoherentReadOptions,
  reader: () => T,
): (cb: (view: T) => void) => void {
  const { spinBudget, retryBudget, where } = options;

  return (cb: (view: T) => void): void => {
    const result = tryRead(pair, reader, { spinBudget, retryBudget });

    if (!result.ok) {
      const { spins, retries } = result.status;

      if (spins >= spinBudget) {
        incrementCounter("spinBudgetExhausted");
      }
      if (retries >= retryBudget) {
        incrementCounter("retryBudgetExhausted");
      }

      const details: CoherentDetails = {
        where,
        spins,
        retries,
      };

      throw createError(
        "binding.coherentRetryExhausted",
        "Coherent read retries exhausted",
        details,
      );
    }

    cb(result.value);
  };
}
