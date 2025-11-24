// File: packages/core/tests/binding/observer.coherence.worker.node.test.ts

/**
 * @fileoverview
 * Cross-thread coherence test for observer binding.
 *
 * Tests that observer.params.within() and observer.meters.snapshot()
 * never see torn/garbage values under concurrent writes.
 */

import { Worker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import {
  allocateShared,
  bindController,
  bindObserver,
  defineSpec,
  planLayout,
} from "../../src";

const PACK_ORDER = [
  "MF64",
  "PF32",
  "PI32",
  "PU",
  "MF32",
  "MU32",
  "MU",
  "PB",
] as const;

type PlaneKey = (typeof PACK_ORDER)[number];

const BYTES_PER_ELEM: Record<PlaneKey, number> = {
  MF64: 8,
  PF32: 4,
  PI32: 4,
  PU: 4,
  MF32: 4,
  MU32: 4,
  MU: 4,
  PB: 1,
};

interface PlaneLayout {
  byteOffset: number;
  elemCount: number;
}

function computePlaneBases(
  planes: Record<PlaneKey, number>,
): Record<PlaneKey, number> {
  const bases = {} as Record<PlaneKey, number>;
  let cursor = 0;

  for (const plane of PACK_ORDER) {
    bases[plane] = cursor;
    cursor += planes[plane];
  }

  return bases;
}

const createSpec = () =>
  defineSpec(({ param, meter }) => ({
    params: {
      gain: param.f32({ min: 0, max: 1 }),
    },
    meters: {
      peak: meter.f32(),
    },
  }));

describe("Observer binding – cross-thread coherence", () => {
  it("sees finite, in-range values under concurrent processor publishes", async () => {
    const spec = createSpec();
    const plan = planLayout(spec);
    const backing = allocateShared(plan);

    const planes = plan.planes as Record<PlaneKey, number>;
    const bases = computePlaneBases(planes);

    const layout: Record<"PF32" | "MF32" | "PU" | "MU", PlaneLayout> = {
      PF32: {
        byteOffset: bases.PF32,
        elemCount: planes.PF32 / BYTES_PER_ELEM.PF32,
      },
      MF32: {
        byteOffset: bases.MF32,
        elemCount: planes.MF32 / BYTES_PER_ELEM.MF32,
      },
      PU: {
        byteOffset: bases.PU,
        elemCount: planes.PU / BYTES_PER_ELEM.PU,
      },
      MU: {
        byteOffset: bases.MU,
        elemCount: planes.MU / BYTES_PER_ELEM.MU,
      },
    };

    // Worker writes peak values from 0 to 1 incrementally.
    // 100k iterations ensures the worker stays busy for the duration of the test.
    const WORKER_ITERATIONS = 100_000;

    const workerScript = `
        const { parentPort, workerData } = require('node:worker_threads');

        const { sab, iterations, layout } = workerData;

        const mf32 = new Float32Array(sab, layout.MF32.byteOffset, layout.MF32.elemCount);
        const mu = new Uint32Array(sab, layout.MU.byteOffset, layout.MU.elemCount);

        const LOCK = 0;
        const SEQ = 1;

        let i = 0;

        function tick() {
          if (i >= iterations) {
            parentPort.postMessage({ type: 'done' });
            return;
          }

          const value = i / iterations; // 0 → ~1

          // Seqlock write protocol for meters
          Atomics.add(mu, LOCK, 1);  // acquire (odd)
          mf32[0] = value;           // write peak
          Atomics.add(mu, LOCK, 1);  // release (even)
          Atomics.add(mu, SEQ, 1);   // commit

          i++;
          setImmediate(tick);
        }

        tick();
      `;

    const worker = new Worker(workerScript, {
      eval: true,
      workerData: {
        sab: backing.sab,
        iterations: WORKER_ITERATIONS,
        layout,
      },
    });

    const controller = bindController(spec, plan, backing);

    // Increase retry budget significantly.
    // The worker runs a tight loop with setImmediate, creating high contention.
    const observer = bindObserver(spec, plan, backing, {
      meters: {
        retryBudget: 100,
        spinBudget: 1000,
      },
    });

    let maxSeenGain = 0;
    let maxSeenPeak = 0;
    let workerDone = false;

    worker.on("message", (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        "type" in msg &&
        (msg as { type: string }).type === "done"
      ) {
        workerDone = true;
      }
    });

    const start = Date.now();
    const OBSERVE_MS = 1000;

    // Run until time expires or we verify the full range.
    // We do NOT break simply because !workerDone, to ensure we catch the end state.
    while (Date.now() - start < OBSERVE_MS) {
      // Controller drives gain from 0 → 1
      const nextGain = Math.min((Date.now() - start) / OBSERVE_MS, 1);
      controller.params.set("gain", nextGain);

      // Params: every observed value must be finite and within [0, 1].
      observer.params.within((view) => {
        const seenGain = view.gain;

        expect(Number.isFinite(seenGain)).toBe(true);
        expect(seenGain).toBeGreaterThanOrEqual(0);
        expect(seenGain).toBeLessThanOrEqual(1);

        if (seenGain > maxSeenGain) {
          maxSeenGain = seenGain;
        }
      });

      // Meters: every observed value must be finite and within [0, 1].
      // This may throw if the retryBudget (set above) is exhausted.
      const meters = observer.meters.snapshot();
      const seenPeak = meters.peak;

      expect(Number.isFinite(seenPeak)).toBe(true);
      expect(seenPeak).toBeGreaterThanOrEqual(0);
      expect(seenPeak).toBeLessThanOrEqual(1);

      if (seenPeak > maxSeenPeak) {
        maxSeenPeak = seenPeak;
      }

      // Early exit if we have seen enough and the worker is done
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (workerDone && maxSeenPeak > 0.95 && maxSeenGain > 0.95) {
        break;
      }

      // Yield to allow worker progress
      await new Promise((r) => setImmediate(r));
    }

    // Under sustained activity, we should have tracked most of the range.
    expect(maxSeenGain).toBeGreaterThan(0.8);
    expect(maxSeenPeak).toBeGreaterThan(0.8);

    await new Promise<void>((resolve, reject) => {
      if (workerDone) {
        resolve();
        return;
      }

      worker.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `observer coherence worker exited with code ${String(code)}`,
          ),
        );
      });

      worker.once("error", reject);
    });
  }, 20_000);
});
