import { Worker } from 'node:worker_threads';

import { describe, it, expect } from 'vitest';

import { tryRead, type SeqPair } from '../../src/primitives/seqlock';

interface SeqlokErrorLike {
  readonly code: string;
}

function isSeqlockTimeout(error: unknown): error is SeqlokErrorLike & {
  readonly code: 'primitives.seqlockTimeout';
} {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const maybe = error as { code?: unknown };
  return maybe.code === 'primitives.seqlockTimeout';
}

describe('seqlock cross-thread stress', () => {
  it('reads monotone values under concurrent publishes', async () => {
    const WRITES = 50_000;
    const VALUE_INDEX = 2;

    // Layout: [LOCK, SEQ, VALUE]
    const sab = new SharedArrayBuffer(3 * 4);
    const u32 = new Uint32Array(sab);
    const pair: SeqPair = { u32, lockIndex: 0, seqIndex: 1 };

    const worker = new Worker(
      `
          const { parentPort, workerData } = require('node:worker_threads');

          /** @type {Uint32Array} */
          const u32 = new Uint32Array(workerData.sab);
          const lockIndex = workerData.lockIndex >>> 0;
          const seqIndex = workerData.seqIndex >>> 0;
          const valueIndex = workerData.valueIndex >>> 0;
          const writes = workerData.writes >>> 0;

          for (let n = 1; n <= writes; n++) {
            // beginWrite: LOCK += 1 (odd)
            Atomics.add(u32, lockIndex, 1);

            // payload write
            u32[valueIndex] = n;

            // endWrite: LOCK += 1 (even)
            Atomics.add(u32, lockIndex, 1);

            // commit: SEQ += 1
            Atomics.add(u32, seqIndex, 1);
          }

          parentPort.postMessage({ type: 'done' });
        `,
      {
        eval: true,
        workerData: {
          sab,
          lockIndex: 0,
          seqIndex: 1,
          valueIndex: VALUE_INDEX,
          writes: WRITES,
        },
      },
    );

    // Optional: track done, but we don't *need* it for the loop now
    let done = false;
    worker.on('message', (msg: unknown) => {
      if (
        typeof msg === 'object' &&
        msg !== null &&
        (msg as { type?: string }).type === 'done'
      ) {
        done = true;
      }
    });

    //  stress loop

    const MAX_OK_READS = 2000;

    let last: number | undefined = undefined;
    let okReads = 0;

    while (okReads < MAX_OK_READS) {
      let res;
      try {
        res = tryRead(pair, () => u32[VALUE_INDEX]);
      } catch (error) {
        // Under the new API, heavy contention can trigger a recoverable timeout.
        // For stress, we treat this as "no coherent read this attempt" and keep spinning.
        if (isSeqlockTimeout(error)) {
          continue;
        }
        throw error;
      }

      if (!res.ok) {
        continue;
      }

      const v = res.value;

      // Allow coherent reads of the initial state (0) before any publish.
      if (v === 0 && last == null) {
        continue;
      }

      if (last == null) {
        // First meaningful value we see must be > 0 (writer starts at 1).
        expect(v).toBeGreaterThan(0);
        last = v;
        okReads += 1;
        continue;
      }

      // After that, values must be monotone non-decreasing.
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
      okReads += 1;
    }

    //  ensure worker exited cleanly

    const exitCode = await new Promise<number>((resolve) => {
      worker.on('exit', (code) => {
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    expect(okReads).toBeGreaterThan(0);
    expect(last).not.toBeNull();
    expect(last).toBeLessThanOrEqual(WRITES);

    // Optional sanity: worker should be done by now
    expect(done).toBe(true);
  }, 20_000);
});
