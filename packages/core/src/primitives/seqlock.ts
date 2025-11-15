/**
 * Seqlock primitives (lock/seq pair).
 *
 * Provides:
 *  - createSeqPair(): bounds-checked indices into a shared U32 plane
 *  - beginWrite()/endWrite(): writer critical section (stamp SEQ before unlock)
 *  - publish(): exception-safe writer wrapper
 *  - tryRead(): best-effort coherent read with bounded spinning/verification
 *      Signature: tryRead(p, reader, options?: { spinBudget?, retryBudget? })
 *      Returns { ok, value, status:{ spins, retries } }.
 *  - acquire(): never-degraded read; retries until success or throws
 *  - getSeq()/isWriterActive(): lightweight helpers
 */

import { addU32, loadU32, spinUntilEven } from './atomics';
import { createError, invariant } from '../errors';

import type { PrimitivesSeqlockTimeoutDetails } from '../errors';

/** Pair of indices into a shared U32 plane that stores `[LOCK, SEQ]`. */
export interface SeqPair {
  readonly u32: Uint32Array;
  readonly lockIndex: number;
  readonly seqIndex: number;
}

/**
 * Construct a SeqPair with bounds validation.
 * @param u32 Plane holding LOCK/SEQ.
 * @param lockIndex Index of the lock word (odd=writer active).
 * @param seqIndex Index of the monotonic sequence stamp.
 */
export function createSeqPair(
  u32: Uint32Array,
  lockIndex: number,
  seqIndex: number,
): SeqPair {
  const len = u32.length >>> 0;

  invariant(
    lockIndex >= 0 && lockIndex < len,
    'internal.assertionFailed',
    'lockIndex out of bounds',
    {
      where: 'primitives.seqlock.createSeqPair',
      detail: `lockIndex=${String(lockIndex)}, len=${String(len)}`,
    },
  );

  invariant(
    seqIndex >= 0 && seqIndex < len,
    'internal.assertionFailed',
    'seqIndex out of bounds',
    {
      where: 'primitives.seqlock.createSeqPair',
      detail: `seqIndex=${String(seqIndex)}, len=${String(len)}`,
    },
  );

  invariant(
    lockIndex !== seqIndex,
    'internal.assertionFailed',
    'lockIndex and seqIndex must differ',
    {
      where: 'primitives.seqlock.createSeqPair',
    },
  );

  return { u32, lockIndex, seqIndex };
}

/** Options for bounded coherent reads. */
export interface TryReadOptions {
  /** Max spins per attempt while waiting for even LOCK. Default: 1024. */
  readonly spinBudget?: number;
  /** Max verification retries if a writer races. Default: 8. */
  readonly retryBudget?: number;
}

export interface ReadStatus {
  /** Total lock-load spins across all attempts. */
  readonly spins: number;
  /** Number of retries consumed (excludes the initial attempt). */
  readonly retries: number;
}

export type TryReadResult<T> =
  | { ok: true; value: T; status: ReadStatus }
  | { ok: false; value: T; status: ReadStatus };

/** Begin a write: even → odd (exclusive). */
export function beginWrite(p: SeqPair): void {
  addU32(p.u32, p.lockIndex, 1);
}

/**
 * End a write: commit the new version first, then unlock.
 *
 * Ordering matters:
 *  - seq++ happens-before readers that validate (seq0 === seq1).
 *  - unlocking after the stamp prevents an even+unchanged illusion
 *    while sampling bytes written under odd LOCK.
 */
export function endWrite(p: SeqPair): void {
  // 1) publish the new version (release edge for readers)
  addU32(p.u32, p.seqIndex, 1);
  // 2) leave the critical section (odd → even)
  addU32(p.u32, p.lockIndex, 1);
}

/**
 * Exception-safe publish wrapper.
 *
 * @remarks
 * This ensures that a writer cannot get stuck in the "odd" (locked) state
 * even if an exception is thrown in the critical section; SEQ is only bumped
 * if `fn` completes without throwing.
 */
export function publish<T>(p: SeqPair, fn: () => T): T {
  beginWrite(p);
  let result: T;
  try {
    result = fn();
  } catch (e) {
    // Best effort: make sure we leave the lock in a consistent state.
    // SEQ is not incremented because the write did not complete.
    addU32(p.u32, p.lockIndex, 1);
    throw e;
  }
  endWrite(p);
  return result;
}

/** Spin result status for introspection/diagnostics. */
export interface SpinStatus {
  /** Total spins consumed across all attempts. */
  readonly spins: number;
  /** Retries consumed because writers raced us. */
  readonly retries: number;
  /**
   * Outcome category:
   *  - 'ok'             → coherent snapshot
   *  - 'writerActive'   → writer never quiesced on this attempt
   *  - 'budgetExhausted'→ exceeded spin/retry budgets
   */
  readonly kind: 'ok' | 'writerActive' | 'budgetExhausted';
}

/**
 * Internal helper: best-effort coherent read with bounded spinning.
 *
 * This is the primitive used by `acquire()`. It never throws; instead it
 * reports whether coherence was achieved within the configured budgets.
 */
export function tryRead<T>(
  p: SeqPair,
  reader: () => T,
  options?: TryReadOptions,
): { ok: boolean; value: T; status: SpinStatus } {
  const spinBudgetOption = options?.spinBudget ?? 1024;
  const retryBudgetOption = options?.retryBudget ?? 8;

  const budgetsAreValid =
    Number.isFinite(spinBudgetOption) &&
    Number.isFinite(retryBudgetOption) &&
    spinBudgetOption >= 0 &&
    retryBudgetOption >= 0 &&
    Number.isInteger(spinBudgetOption) &&
    Number.isInteger(retryBudgetOption);

  invariant(
    budgetsAreValid,
    'primitives.invalidSpinBudget',
    'Spin budget must be non-negative integer',
    {
      where: 'primitives.seqlock.tryRead',
      detail: `spinBudget=${String(spinBudgetOption)}, retryBudget=${String(
        retryBudgetOption,
      )}`,
    },
  );

  const spinBudget = spinBudgetOption;
  const retryBudget = retryBudgetOption;

  let totalSpins = 0;
  let retriesUsed = 0;

  // Attempt 0 + up to `retryBudget` additional retries.
  while (retriesUsed <= retryBudget) {
    const spinResult = spinUntilEven(p.u32, p.lockIndex, spinBudget);

    if (!spinResult) {
      // Never observed an even LOCK within spin budget.
      const status: SpinStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: 'writerActive',
      };
      // Return a degraded result instead of throwing; acquire() decides.
      return { ok: false, value: reader(), status };
    }

    totalSpins += spinResult.spins;

    const seq0 = loadU32(p.u32, p.seqIndex);
    const value = reader();
    const seq1 = loadU32(p.u32, p.seqIndex);

    if (seq0 === seq1 && (loadU32(p.u32, p.lockIndex) & 1) === 0) {
      const status: SpinStatus = {
        spins: totalSpins,
        retries: retriesUsed,
        kind: 'ok',
      };
      return { ok: true, value, status };
    }

    retriesUsed += 1;
  }

  // Budgets exhausted (spins or retries). This is considered a timeout in
  // the sense of the primitives domain; we surface it as a structured error.
  const details = {
    where: 'primitives.seqlock.tryRead',
    detail: `spinBudget=${String(spinBudget)}, retries=${String(retryBudget)}, spins=${String(
      totalSpins,
    )}, retriesUsed=${String(retriesUsed)}`,
    spinBudget,
    actualSpins: totalSpins,
  } as const satisfies PrimitivesSeqlockTimeoutDetails;

  throw createError('primitives.seqlockTimeout', 'Seqlock acquisition timeout', details);
}

/**
 * Acquire a coherent snapshot, optionally degrading to "latest" under
 * pathological contention.
 */
export interface AcquireOptions extends TryReadOptions {
  /**
   * Degrade policy when budgets are exhausted:
   *  - 'never'       → keep retrying until maxAttempts then throw
   *  - 'returnLatest'→ return the last sampled value even if coherence
   *                    could not be proven
   *
   * Default: 'never'
   */
  readonly degrade?: 'never' | 'returnLatest';

  /**
   * Hard cap on number of tryRead attempts before giving up.
   * Default: 1000
   */
  readonly maxAttempts?: number;
}

/**
 * High-level acquire primitive:
 *
 * - Uses `tryRead` internally for bounded coherent attempts.
 * - Will retry up to `maxAttempts` times.
 * - Respects `degrade` to optionally return the latest sampled value instead
 *   of throwing when the seqlock cannot be proven coherent.
 */
export function acquire<T>(p: SeqPair, reader: () => T, options?: AcquireOptions): T {
  const degrade = options?.degrade ?? 'never';
  const maxAttempts = options?.maxAttempts ?? 1000;

  let attempts = 0;
  let lastValue: T | undefined;
  let totalSpins = 0;

  while (attempts < maxAttempts) {
    const result = tryRead(p, reader, options);
    totalSpins += result.status.spins;
    attempts += 1;

    if (result.ok) {
      return result.value;
    }

    lastValue = result.value;

    // Writer stayed active; just retry.
    if (result.status.kind === 'writerActive') {
      // Loop continues, budgets are reset per tryRead call.
      continue;
    }

    // Budget exhausted inside tryRead; either degrade or continue.
    if (result.status.kind === 'budgetExhausted') {
      if (degrade === 'returnLatest' && lastValue !== undefined) {
        return lastValue;
      }
      // Otherwise, fall through and let the outer attempts budget decide.
    }
  }

  // Exceeded maxAttempts: surface a structured timeout.
  const details = {
    where: 'primitives.seqlock.acquire',
    detail: `maxAttempts=${String(maxAttempts)}, degrade=${degrade}, spins=${String(
      totalSpins,
    )}`,
    spinBudget: options?.spinBudget ?? 1024,
    actualSpins: totalSpins,
  } as const satisfies PrimitivesSeqlockTimeoutDetails;

  throw createError('primitives.seqlockTimeout', 'Seqlock acquisition timeout', details);
}

/** Current monotonic SEQ (u32). */
export function getSeq(p: SeqPair): number {
  return loadU32(p.u32, p.seqIndex);
}

/** Whether a writer is currently active (LOCK odd). */
export function isWriterActive(p: SeqPair): boolean {
  return (loadU32(p.u32, p.lockIndex) & 1) === 1;
}
