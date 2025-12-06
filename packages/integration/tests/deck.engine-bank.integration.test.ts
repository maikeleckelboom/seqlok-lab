/**
 * @file deck.engine-bank.integration.test.ts
 *
 * Engine-bank level integration tests for the Seqlok deck hot-swap pipeline.
 *
 * This test extends the deck.timeline harness with a tiny EngineBank that
 * renders constant-valued engines (A = 1.0, B = 2.0, C = 3.0) so we can assert
 * sample-level crossfade semantics without touching Web Audio.
 */

import { createCommandMailbox } from "@seqlok/commands";
import {
  createHotswapCommandCodec,
  createTicketId,
  HOTSWAP_COMMAND_TAG_INSTALL,
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  type HotswapCommand,
  type SwapStepDecisionRT,
  type SwapTicketRT,
} from "@seqlok/hotswap";
import { describe, expect, it } from "vitest";

import {
  createHotswapSlotDriver,
  createSlicerState,
  processTimelineBlock,
  scheduleSwap,
  type HotswapSchedulerConfig,
  type TimelineCommand,
  type TimelineDriver,
  type TimelineProcessCallbacks,
} from "../src";

import type { SwsrRingLayout } from "@seqlok/primitives";

/**
 * Minimal engine kind enum for testing the hot-swap protocol.
 */
enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
  C = 3,
}

/**
 * Simple engine abstraction: render into a Float32Array for N frames.
 */
interface EngineInstance {
  readonly kind: EngineKind;
  render(dst: Float32Array, frames: number): void;
}

/**
 * Test engine that outputs a constant value.
 *
 * A = 1.0, B = 2.0, C = 3.0 so crossfade math becomes easy to reason about:
 * output = currentGain * A + nextGain * B/C.
 */
class ConstantEngine implements EngineInstance {
  constructor(
    public readonly kind: EngineKind,
    private readonly value: number,
  ) {}

  render(dst: Float32Array, frames: number): void {
    for (let i = 0; i < frames; i += 1) {
      dst[i] = this.value;
    }
  }
}

/**
 * EngineBank indirection so the deck never talks to engines directly.
 */
interface EngineBank<K extends number> {
  get(kind: K): EngineInstance | null;
  unregister(kind: K): void;
}

class SimpleEngineBank implements EngineBank<EngineKind> {
  private readonly map = new Map<EngineKind, EngineInstance>();

  register(engine: EngineInstance): void {
    this.map.set(engine.kind, engine);
  }

  unregister(kind: EngineKind): void {
    this.map.delete(kind);
  }

  get(kind: EngineKind): EngineInstance | null {
    return this.map.get(kind) ?? null;
  }
}

/**
 * Audio block + decision snapshot for assertions.
 */
interface RecordedAudioBlock {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly samples: Float32Array;
  readonly decision: SwapStepDecisionRT<EngineKind>;
}

/**
 * Integration harness: stitches together mailbox + hotswap + timeline +
 * a tiny EngineBank and exposes helper methods for the tests.
 */
interface DeckEngineHarness {
  readonly timeline: TimelineDriver<EngineKind>;
  readonly bank: SimpleEngineBank;
  readonly pendingRTCommands: TimelineCommand<EngineKind>[];
  readonly recordedAudio: RecordedAudioBlock[];
  readonly schedulerConfig: HotswapSchedulerConfig<
    EngineKind,
    HotswapCommand<EngineKind>
  >;

  simulateBlock(blockFrames: number): void;

  runUntilSwapComplete(
    blockFrames: number,
    maxBlocks: number,
  ): { completed: boolean; blocksRun: number };
}

function createDeckEngineHarness(): DeckEngineHarness {
  const codec = createHotswapCommandCodec<EngineKind>();

  const layout: SwsrRingLayout = {
    capacity: 16,
    wordsPerSlot: HOTSWAP_COMMAND_WORDS_PER_SLOT,
  };

  const mailbox = createCommandMailbox<HotswapCommand<EngineKind>>({
    mailboxId: "deck-0",
    codec,
    layout,
  });

  const hotswapSlot = createHotswapSlotDriver<EngineKind>();

  const timeline: TimelineDriver<EngineKind> = {
    frame: 0,
    isPlaying: true,
    slicer: createSlicerState<TimelineCommand<EngineKind>>(),
    hotswapSlot,
  };

  const schedulerConfig: HotswapSchedulerConfig<
    EngineKind,
    HotswapCommand<EngineKind>
  > = {
    mailboxId: "deck-0",
    producer: mailbox.producer,
    encodeInstallSwap(
      ticket: SwapTicketRT<EngineKind>,
    ): HotswapCommand<EngineKind> {
      return { tag: HOTSWAP_COMMAND_TAG_INSTALL, ticket };
    },
  };

  // Engine bank with constant engines: A = 1, B = 2, C = 3.
  const bank = new SimpleEngineBank();
  bank.register(new ConstantEngine(EngineKind.A, 1.0));
  bank.register(new ConstantEngine(EngineKind.B, 2.0));
  bank.register(new ConstantEngine(EngineKind.C, 3.0));

  const pendingRTCommands: TimelineCommand<EngineKind>[] = [];
  const recordedAudio: RecordedAudioBlock[] = [];

  let activeEngineKind: EngineKind = EngineKind.A;
  let blockIndex = 0;

  // Crossfade runtime state, maintained entirely in the harness. We treat the
  // crossfade as a linear ramp over ticket.fadeFrames.
  let crossfadeFramesElapsed = 0;
  let lastPhase: string | null = null;

  function getActiveTicketFadeFrames(): number {
    const ticket = hotswapSlot.state?.ticket ?? null;
    if (ticket === null) {
      return 0;
    }
    return ticket.fadeFrames;
  }

  function mixCrossfade(
    dst: Float32Array,
    frames: number,
    status: SwapStepDecisionRT<EngineKind>["status"],
  ): void {
    const current = bank.get(status.activeEngineKind);
    const next = bank.get(status.nextEngineKind);

    const totalFadeFrames = getActiveTicketFadeFrames();
    if (totalFadeFrames <= 0) {
      // Degenerate case: no fade, just jump to next engine.
      if (next !== null) {
        next.render(dst, frames);
      } else if (current !== null) {
        current.render(dst, frames);
      } else {
        for (let i = 0; i < frames; i += 1) {
          dst[i] = 0;
        }
      }
      return;
    }

    const currentBuf = new Float32Array(frames);
    const nextBuf = new Float32Array(frames);

    if (current !== null) {
      current.render(currentBuf, frames);
    } else {
      for (let i = 0; i < frames; i += 1) {
        currentBuf[i] = 0;
      }
    }

    if (next !== null) {
      next.render(nextBuf, frames);
    } else {
      for (let i = 0; i < frames; i += 1) {
        nextBuf[i] = 0;
      }
    }

    const segmentStart = crossfadeFramesElapsed;
    const segmentEnd = segmentStart + frames;

    for (let i = 0; i < frames; i += 1) {
      const globalFrame = segmentStart + i;
      const clampedFrame =
        globalFrame >= totalFadeFrames ? totalFadeFrames : globalFrame;
      const progress =
        totalFadeFrames === 0 ? 1 : clampedFrame / totalFadeFrames;

      const currentGain = 1 - progress;
      const nextGain = progress;

      const currentSample = currentBuf[i] ?? 0;
      const nextSample = nextBuf[i] ?? 0;

      dst[i] = currentSample * currentGain + nextSample * nextGain;
    }

    crossfadeFramesElapsed = segmentEnd;
  }

  function simulateBlock(blockFrames: number): void {
    const currentBlockIndex = blockIndex;
    let segmentIndex = 0;

    // Drain mailbox into pendingRTCommands.
    mailbox.consumer.drain({
      onCommand(command: HotswapCommand<EngineKind>): void {
        const { ticket } = command;
        pendingRTCommands.push({
          atFrame: ticket.atFrame,
          priority: 0,
          payload: {
            kind: "installSwap",
            ticket,
          },
        });
      },
    });

    const blockStart = timeline.frame;
    const blockEnd = blockStart + blockFrames;

    const drainedCommands: TimelineCommand<EngineKind>[] = [];

    for (let i = pendingRTCommands.length - 1; i >= 0; i -= 1) {
      const cmd = pendingRTCommands[i];
      if (cmd === undefined) {
        // noUncheckedIndexedAccess support
        continue;
      }
      if (cmd.atFrame < blockEnd) {
        drainedCommands.push(cmd);
        pendingRTCommands.splice(i, 1);
      }
    }

    drainedCommands.sort((a, b) => {
      if (a.atFrame !== b.atFrame) {
        return a.atFrame - b.atFrame;
      }
      return a.priority - b.priority;
    });

    const callbacks: TimelineProcessCallbacks<EngineKind> = {
      renderSegment(frames: number): void {
        const currentNextKind: EngineKind = hotswapSlot.hasState
          ? (hotswapSlot.state?.ticket.engineKind ?? EngineKind.None)
          : EngineKind.None;

        const decision = hotswapSlot.stepBlock(
          frames,
          activeEngineKind,
          currentNextKind,
          EngineKind.None,
        );

        // Ignore zero-length segments for audio recording: they are protocol
        // artifacts and should not produce samples.
        if (frames > 0) {
          const samples = new Float32Array(frames);

          if (decision.status.phase === "crossfade") {
            if (lastPhase !== "crossfade") {
              crossfadeFramesElapsed = 0;
            }
            mixCrossfade(samples, frames, decision.status);
          } else if (decision.kind === "runCurrentAndPrewarmNext") {
            const current = bank.get(decision.status.activeEngineKind);
            if (current !== null) {
              current.render(samples, frames);
            } else {
              for (let i = 0; i < frames; i += 1) {
                samples[i] = 0;
              }
            }

            const next = bank.get(decision.status.nextEngineKind);
            if (next !== null) {
              const scratch = new Float32Array(frames);
              next.render(scratch, frames);
              // scratch is intentionally discarded: prewarm only
            }
          } else {
            const current = bank.get(decision.status.activeEngineKind);
            if (current !== null) {
              current.render(samples, frames);
            } else {
              for (let i = 0; i < frames; i += 1) {
                samples[i] = 0;
              }
            }
          }

          recordedAudio.push({
            blockIndex: currentBlockIndex,
            segmentIndex,
            samples,
            decision,
          });

          segmentIndex += 1;
        }

        lastPhase = decision.status.phase;

        if (decision.kind === "retireNow") {
          activeEngineKind = decision.status.nextEngineKind;
          crossfadeFramesElapsed = 0;
        }
      },
    };

    processTimelineBlock(timeline, blockFrames, drainedCommands, callbacks);
    blockIndex += 1;
  }

  function runUntilSwapComplete(
    blockFrames: number,
    maxBlocks: number,
  ): { completed: boolean; blocksRun: number } {
    let blocksRun = 0;
    let sawNonIdlePhase = false;

    for (let i = 0; i < maxBlocks; i += 1) {
      simulateBlock(blockFrames);
      blocksRun += 1;

      const lastBlock = recordedAudio[recordedAudio.length - 1];
      if (lastBlock !== undefined) {
        const phase = lastBlock.decision.status.phase;
        if (phase !== "idle") {
          sawNonIdlePhase = true;
        } else if (sawNonIdlePhase) {
          return { completed: true, blocksRun };
        }
      }
    }

    return { completed: false, blocksRun };
  }

  return {
    timeline,
    bank,
    pendingRTCommands,
    recordedAudio,
    schedulerConfig,
    simulateBlock,
    runUntilSwapComplete,
  };
}

/**
 * Sample-level semantics for typical swaps.
 */
describe("deck engine bank integration: sample-level crossfade semantics", () => {
  it("without any swap scheduled, output equals current engine value", () => {
    const harness = createDeckEngineHarness();
    const { recordedAudio } = harness;
    const blockFrames = 64;

    for (let i = 0; i < 3; i += 1) {
      harness.simulateBlock(blockFrames);
    }

    const baselineBlocks = recordedAudio.filter((b) => {
      const kind = b.decision.kind;
      return kind === "idle" || kind === "runCurrentOnly";
    });

    expect(baselineBlocks.length).toBeGreaterThan(0);

    for (const block of baselineBlocks) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(1.0, 5);
      }
    }
  });

  it("during prewarm, output equals only current (next is rendered but discarded)", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(2),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 2,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const prewarmBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "prewarm",
    );

    expect(prewarmBlocks.length).toBe(2);

    for (const block of prewarmBlocks) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(1.0, 5);
      }
    }
  });

  it("during crossfade, output is weighted sum between engine A and B", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(3),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeGreaterThan(0);

    const firstBlock = crossfadeBlocks[0];
    const lastBlock = crossfadeBlocks[crossfadeBlocks.length - 1];

    if (firstBlock === undefined || lastBlock === undefined) {
      throw new Error("crossfadeBlocks should not be empty");
    }

    const firstSum = firstBlock.samples.reduce((sum, v) => sum + v, 0);
    const firstAvg = firstSum / firstBlock.samples.length;

    const lastSum = lastBlock.samples.reduce((sum, v) => sum + v, 0);
    const lastAvg = lastSum / lastBlock.samples.length;

    // First crossfade block: still mostly A (1.0), but above 1.0.
    expect(firstAvg).toBeGreaterThan(1.0);
    expect(firstAvg).toBeLessThan(1.5);

    // Last crossfade block: mostly B (2.0).
    expect(lastAvg).toBeGreaterThan(1.5);
    expect(lastAvg).toBeLessThan(2.0);

    const averages: number[] = crossfadeBlocks.map((block) => {
      const sum = block.samples.reduce((acc, v) => acc + v, 0);
      return sum / block.samples.length;
    });

    let prevAvg: number | null = null;
    for (const avg of averages) {
      if (prevAvg !== null) {
        expect(avg).toBeGreaterThanOrEqual(prevAvg - 0.01);
      }
      prevAvg = avg;
    }
  });

  it("after retire, only next engine is active", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(4),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    let afterRetire = false;
    const postRetireBlocks: RecordedAudioBlock[] = [];

    for (const block of recordedAudio) {
      if (block.decision.kind === "retireNow") {
        afterRetire = true;
        continue;
      }
      if (afterRetire && block.decision.status.phase === "idle") {
        postRetireBlocks.push(block);
      }
    }

    expect(postRetireBlocks.length).toBeGreaterThan(0);

    for (const block of postRetireBlocks) {
      expect(block.decision.status.activeEngineKind).toBe(EngineKind.B);
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(2.0, 5);
      }
    }
  });

  it("multi-block crossfade yields a monotonic gain envelope", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 32;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(5),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeGreaterThanOrEqual(3);

    const averages: number[] = crossfadeBlocks.map((block) => {
      const sum = block.samples.reduce((acc, v) => acc + v, 0);
      return sum / block.samples.length;
    });

    const first = averages[0];
    const last = averages[averages.length - 1];

    if (first === undefined || last === undefined) {
      throw new Error("unexpected empty averages");
    }

    // Start near A, end near B, without insisting on exact endpoints.
    expect(first).toBeGreaterThan(1.0);
    expect(first).toBeLessThan(1.5);
    expect(last).toBeGreaterThan(1.5);
    expect(last).toBeLessThan(2.0);

    let prevAvg: number | null = null;
    for (const avg of averages) {
      if (prevAvg !== null) {
        expect(avg).toBeGreaterThanOrEqual(prevAvg - 0.01);
      }
      prevAvg = avg;
    }
  });

  it("zero-length segments produce no samples", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 128;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(6),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.simulateBlock(blockFrames);

    for (const block of recordedAudio) {
      expect(block.samples.length).toBeGreaterThan(0);
    }
  });

  it("handles same-engine swap (A→A) with correct sample values", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(7),
      engineKind: EngineKind.A,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 1,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    for (const block of crossfadeBlocks) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(1.0, 5);
      }
    }
  });
});

/**
 * Edge-case semantics and failure modes.
 */
describe("deck engine bank integration: edge cases", () => {
  it("handles engine returning null (silent output)", () => {
    const harness = createDeckEngineHarness();
    const { bank, schedulerConfig, recordedAudio } = harness;

    // Remove engine B: simulates missing engine in the bank.
    bank.unregister(EngineKind.B);

    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(8),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeGreaterThan(0);

    const averages: number[] = crossfadeBlocks.map((block) => {
      const sum = block.samples.reduce((acc, v) => acc + v, 0);
      return sum / block.samples.length;
    });

    const maxAvg = Math.max(...averages);
    const minAvg = Math.min(...averages);

    // With missing next engine, energy decays from 1.0 towards 0.0.
    // We only assert that it stays within (0, 1) and does not blow up.
    expect(maxAvg).toBeLessThan(1.0);
    expect(minAvg).toBeGreaterThan(0.0);
  });

  it("very short fadeFrames produces rapid but smooth transition", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 128;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(9),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 32,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);
    harness.runUntilSwapComplete(blockFrames, 50);

    const crossfadeBlocks = recordedAudio.filter(
      (b) => b.decision.status.phase === "crossfade",
    );

    expect(crossfadeBlocks.length).toBeLessThanOrEqual(2);

    const firstBlock = crossfadeBlocks[0];
    const lastBlock = crossfadeBlocks[crossfadeBlocks.length - 1];

    if (firstBlock === undefined || lastBlock === undefined) {
      throw new Error("crossfadeBlocks should not be empty");
    }

    expect(firstBlock.samples[0]).toBeCloseTo(1.0, 1);
    expect(lastBlock.samples[lastBlock.samples.length - 1]).toBeCloseTo(2.0, 1);
  });
});

/**
 * Higher-order semantics: overlapping and sequential swaps.
 * These are marked skip until the runtime policy for overlapping swaps
 * (reject vs queue) is fully implemented.
 */
describe("deck engine bank integration: higher-order swaps", () => {
  it.skip("rejects overlapping swaps: second ticket to C never takes effect during A→B", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio } = harness;
    const blockFrames = 64;

    // First swap: A → B.
    const ticketAB: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(10),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketAB);

    // Second swap: try to go B → C while A→B is still active.
    const ticketBC: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(11),
      engineKind: EngineKind.C,
      atFrame: 32, // inside the first fade window
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketBC);

    harness.runUntilSwapComplete(blockFrames, 200);

    // Spec: overlapping swap is rejected/ignored.
    // No block should ever reference C as active or next engine.
    const touchedC = recordedAudio.some((block) => {
      const status = block.decision.status;
      return (
        status.activeEngineKind === EngineKind.C ||
        status.nextEngineKind === EngineKind.C
      );
    });

    expect(touchedC).toBe(false);

    // After retire, deck should be running pure B (2.0).
    let sawRetire = false;
    const postRetireBlocks: RecordedAudioBlock[] = [];

    for (const block of recordedAudio) {
      if (block.decision.kind === "retireNow") {
        sawRetire = true;
        continue;
      }
      if (sawRetire && block.decision.status.phase === "idle") {
        postRetireBlocks.push(block);
      }
    }

    expect(postRetireBlocks.length).toBeGreaterThan(0);

    for (const block of postRetireBlocks) {
      expect(block.decision.status.activeEngineKind).toBe(EngineKind.B);
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(2.0, 5);
      }
    }
  });

  it("supports sequential swaps A→B→C without regressing engines", () => {
    const harness = createDeckEngineHarness();
    const { schedulerConfig, recordedAudio, timeline } = harness;
    const blockFrames = 64;

    // First swap: A → B.
    const ticketAB: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(20),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketAB);
    harness.runUntilSwapComplete(blockFrames, 100);

    const recordedAfterFirst = recordedAudio.length;

    // Sanity: we should have at least one idle block with B only.
    const idleWithB = recordedAudio.filter(
      (block) =>
        block.decision.status.phase === "idle" &&
        block.decision.status.activeEngineKind === EngineKind.B,
    );

    expect(idleWithB.length).toBeGreaterThan(0);

    for (const block of idleWithB) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(2.0, 5);
      }
    }

    // Second swap: B → C, scheduled after the current timeline frame.
    const ticketBC: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(21),
      engineKind: EngineKind.C,
      atFrame: timeline.frame, // next block boundary
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketBC);
    harness.runUntilSwapComplete(blockFrames, 100);

    const newBlocks = recordedAudio.slice(recordedAfterFirst);

    // There must be at least one idle block with C at the end.
    const idleWithC = newBlocks.filter(
      (block) =>
        block.decision.status.phase === "idle" &&
        block.decision.status.activeEngineKind === EngineKind.C,
    );

    expect(idleWithC.length).toBeGreaterThan(0);

    for (const block of idleWithC) {
      for (const sample of block.samples) {
        expect(sample).toBeCloseTo(3.0, 5);
      }
    }

    // Once we've seen idle with B, we should never see idle with A again.
    const firstIdleBIndex = recordedAudio.findIndex(
      (block) =>
        block.decision.status.phase === "idle" &&
        block.decision.status.activeEngineKind === EngineKind.B,
    );

    expect(firstIdleBIndex).toBeGreaterThanOrEqual(0);

    const idleWithAAfterB = recordedAudio
      .slice(firstIdleBIndex)
      .filter(
        (block) =>
          block.decision.status.phase === "idle" &&
          block.decision.status.activeEngineKind === EngineKind.A,
      );

    expect(idleWithAAfterB.length).toBe(0);
  });
});
