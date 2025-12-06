/**
 * @file deck.timeline.integration.test.ts
 *
 * End-to-end integration test for the Seqlok deck hot-swap happy path.
 *
 * This test stitches together three layers:
 *   1. Commands layer: CommandMailbox + HotswapCommandCodec
 *   2. Hotswap layer: scheduleSwap + HotswapSlotDriver
 *   3. Integration layer: TimelineDriver + processTimelineBlock + timeline-slicer
 *
 * True E2E flow:
 *   Host side:
 *     - Creates a SwapTicketRT with atFrame, fadeFrames, preWarmBlocks
 *     - Calls scheduleSwap(config, ticket) → validates ticket → enqueues HotswapCommand into mailbox
 *
 *   RT side (per audio block):
 *     - Drains mailbox.consumer → projects HotswapCommand to TimelineCommand
 *     - Feeds TimelineCommands into processTimelineBlock
 *     - Inside renderSegment, calls slot.stepBlock and records decisions
 *
 *   Assertions:
 *     - Before atFrame boundary, all steps return kind: "idle"
 *     - On/after the boundary, the slot has accepted the ticket
 *     - Eventually the swap reaches phase: "idle" with activeEngineKind === ticket.engineKind
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
  type TicketId,
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

// Test Domain Types

/**
 * Minimal engine kind enum for testing the hot-swap protocol.
 * None is the sentinel indicating "no engine", A is the initial engine,
 * and B is the target engine we swap to.
 */
enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
}

/**
 * Recorded step decision for post-hoc assertion.
 */
interface RecordedStep {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly segmentFrames: number;
  readonly decision: SwapStepDecisionRT<EngineKind>;
}

/**
 * Recorded command application for tracking timeline command side effects.
 */
interface RecordedCommand {
  readonly blockIndex: number;
  readonly command: TimelineCommand<EngineKind>;
}

// Test Harness

interface DeckTimelineHarness {
  readonly timeline: TimelineDriver<EngineKind>;
  readonly pendingRTCommands: TimelineCommand<EngineKind>[];
  readonly recordedSteps: RecordedStep[];
  readonly recordedCommands: RecordedCommand[];
  readonly schedulerConfig: HotswapSchedulerConfig<
    EngineKind,
    HotswapCommand<EngineKind>
  >;

  /**
   * Simulates a single audio block on the RT side.
   * Drains pending commands, processes the timeline block, and records all
   * hotswap step decisions made during segment rendering.
   */
  simulateBlock(blockFrames: number): void;

  /**
   * Runs the RT simulation until the swap completes (returns to idle phase
   * with the target engine active) or maxBlocks is exceeded.
   */
  runUntilSwapComplete(
    blockFrames: number,
    maxBlocks: number,
  ): { completed: boolean; blocksRun: number };
}

function createDeckTimelineHarness(): DeckTimelineHarness {
  // Set up real CommandMailbox with hotswap codec
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

  // Create real HotswapSlotDriver
  const hotswapSlot = createHotswapSlotDriver<EngineKind>();

  // Create TimelineDriver with real slot driver
  const timeline: TimelineDriver<EngineKind> = {
    frame: 0,
    isPlaying: true,
    slicer: createSlicerState<TimelineCommand<EngineKind>>(),
    hotswapSlot,
  };

  // Scheduler configuration for host-side scheduling
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

  // Pending RT commands queue.
  //
  // Normally this is fed only by mailbox.consumer.drain (installSwap), but tests
  // may push additional commands directly to exercise priority and ordering.
  const pendingRTCommands: TimelineCommand<EngineKind>[] = [];

  // Recording arrays for assertions
  const recordedSteps: RecordedStep[] = [];
  const recordedCommands: RecordedCommand[] = [];

  // Track current active engine (starts with A)
  let activeEngineKind: EngineKind = EngineKind.A;
  let blockIndex = 0;

  function simulateBlock(blockFrames: number): void {
    const currentBlockIndex = blockIndex;
    let segmentIndex = 0;

    // Drain mailbox and project HotswapCommand → TimelineCommand.
    // This is the true E2E path: scheduleSwap enqueues to mailbox,
    // RT side drains mailbox and creates timeline commands.
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

    // Drain pending RT commands that fall into this block
    for (let i = pendingRTCommands.length - 1; i >= 0; i -= 1) {
      const cmd = pendingRTCommands[i];
      if (cmd !== undefined && cmd.atFrame < blockEnd) {
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

        recordedSteps.push({
          blockIndex: currentBlockIndex,
          segmentIndex,
          segmentFrames: frames,
          decision,
        });

        if (decision.kind === "retireNow") {
          activeEngineKind = currentNextKind;
        }

        segmentIndex += 1;
      },
      applyCommandSideEffects(cmd: TimelineCommand<EngineKind>): void {
        recordedCommands.push({
          blockIndex: currentBlockIndex,
          command: cmd,
        });
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

    for (let i = 0; i < maxBlocks; i++) {
      simulateBlock(blockFrames);
      blocksRun += 1;

      // Check the last recorded step
      const lastStep = recordedSteps[recordedSteps.length - 1];
      if (lastStep !== undefined) {
        const phase = lastStep.decision.status.phase;
        if (phase !== "idle") {
          sawNonIdlePhase = true;
        } else if (sawNonIdlePhase) {
          // We saw non-idle phases and now returned to idle = completed
          return { completed: true, blocksRun };
        }
      }
    }

    return { completed: false, blocksRun };
  }

  return {
    timeline,
    pendingRTCommands,
    recordedSteps,
    recordedCommands,
    schedulerConfig,
    simulateBlock,
    runUntilSwapComplete,
  };
}

// Test Suite

describe("deck timeline integration: scheduleSwap → mailbox → timeline → hotswap slot", () => {
  it("completes a full hot-swap cycle from idle to swap to idle", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 128;
    const atFrame = 256; // Swap starts after 2 blocks
    const fadeFrames = 256; // 2 blocks of crossfade
    const preWarmBlocks = 2;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(1),
      engineKind: EngineKind.B,
      atFrame,
      fadeFrames,
      preWarmBlocks,
    };

    expect(() => {
      scheduleSwap(schedulerConfig, ticket);
    }).not.toThrow();

    const { completed, blocksRun } = harness.runUntilSwapComplete(
      blockFrames,
      100,
    );

    expect(completed).toBe(true);
    expect(blocksRun).toBeGreaterThan(2);

    // Verify: Before atFrame, all steps should be idle
    const preSwapSteps = recordedSteps.filter((s) => {
      const stepFrame = s.blockIndex * blockFrames;
      return stepFrame < atFrame;
    });
    for (const step of preSwapSteps) {
      expect(step.decision.kind).toBe("idle");
      expect(step.decision.status.phase).toBe("idle");
    }

    // Verify: We saw the full swap lifecycle
    const phases = recordedSteps.map((s) => s.decision.status.phase);
    const kinds = recordedSteps.map((s) => s.decision.kind);

    expect(phases).toContain("spawn");
    expect(phases).toContain("prime");
    expect(phases).toContain("prewarm");
    expect(phases).toContain("crossfade");
    expect(phases).toContain("retire");

    expect(kinds).toContain("runCurrentOnly");
    expect(kinds).toContain("runCurrentAndPrewarmNext");
    expect(kinds).toContain("runBothForCrossfade");
    expect(kinds).toContain("retireNow");

    // Final step should be idle with engine B active
    const finalStep = recordedSteps[recordedSteps.length - 1];
    expect(finalStep).toBeDefined();
    expect(finalStep?.decision.status.phase).toBe("idle");
    expect(finalStep?.decision.status.activeEngineKind).toBe(EngineKind.B);
    expect(finalStep?.decision.status.nextEngineKind).toBe(EngineKind.None);
  });

  it("handles immediate swap at frame 0", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 64;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(2),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);

    const { completed } = harness.runUntilSwapComplete(blockFrames, 50);
    expect(completed).toBe(true);

    const phases = recordedSteps.map((s) => s.decision.status.phase);
    expect(phases).toContain("spawn");
    expect(phases).toContain("prime");
    expect(phases).toContain("crossfade");
    expect(phases).toContain("retire");

    const prewarmSteps = recordedSteps.filter(
      (s) => s.decision.status.phase === "prewarm",
    );
    expect(prewarmSteps).toHaveLength(0);
  });

  it("correctly counts prewarm blocks", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 128;
    const preWarmBlocks = 4;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(3),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks,
    };

    scheduleSwap(schedulerConfig, ticket);

    harness.runUntilSwapComplete(blockFrames, 50);

    const prewarmSteps = recordedSteps.filter(
      (s) => s.decision.status.phase === "prewarm",
    );
    expect(prewarmSteps).toHaveLength(preWarmBlocks);

    for (const step of prewarmSteps) {
      expect(step.decision.kind).toBe("runCurrentAndPrewarmNext");
    }
  });

  it("handles multi-block crossfade", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 64;
    const fadeFrames = 256;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(4),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);

    harness.runUntilSwapComplete(blockFrames, 50);

    // Count crossfade steps
    const crossfadeSteps = recordedSteps.filter(
      (s) => s.decision.status.phase === "crossfade",
    );

    // Should have approximately fadeFrames / blockFrames crossfade steps
    // (might be off by one due to how fadeFramesRemaining is decremented)
    expect(crossfadeSteps.length).toBeGreaterThanOrEqual(3);
    expect(crossfadeSteps.length).toBeLessThanOrEqual(5);

    // All crossfade steps should have kind: "runBothForCrossfade"
    for (const step of crossfadeSteps) {
      expect(step.decision.kind).toBe("runBothForCrossfade");
    }
  });

  it("records installSwap command via applyCommandSideEffects", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedCommands } = harness;

    const blockFrames = 128;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(5),
      engineKind: EngineKind.B,
      atFrame: 64,
      fadeFrames: 128,
      preWarmBlocks: 1,
    };

    scheduleSwap(schedulerConfig, ticket);

    harness.simulateBlock(blockFrames);

    expect(recordedCommands).toHaveLength(1);
    const recorded = recordedCommands[0];
    expect(recorded).toBeDefined();
    expect(recorded?.command.payload.kind).toBe("installSwap");
    if (recorded?.command.payload.kind === "installSwap") {
      expect(recorded.command.payload.ticket.ticketId).toBe(ticket.ticketId);
    }
  });

  it("properly advances timeline.frame across blocks", () => {
    const harness = createDeckTimelineHarness();
    const { timeline, schedulerConfig } = harness;

    const blockFrames = 128;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(6),
      engineKind: EngineKind.B,
      atFrame: 128,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);

    expect(timeline.frame).toBe(0);

    harness.simulateBlock(blockFrames);
    expect(timeline.frame).toBe(128);

    harness.simulateBlock(blockFrames);
    expect(timeline.frame).toBe(256);

    harness.simulateBlock(blockFrames);
    expect(timeline.frame).toBe(384);
  });
});

describe("deck timeline integration: edge cases", () => {
  it("handles late command (atFrame already passed)", () => {
    const harness = createDeckTimelineHarness();
    const { timeline, schedulerConfig, recordedCommands } = harness;

    const blockFrames = 128;

    harness.simulateBlock(blockFrames);
    harness.simulateBlock(blockFrames);
    expect(timeline.frame).toBe(256);

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(8),
      engineKind: EngineKind.B,
      atFrame: 64,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);

    harness.simulateBlock(blockFrames);

    expect(recordedCommands).toHaveLength(1);
    expect(recordedCommands[0]?.command.payload.kind).toBe("installSwap");
  });

  it("maintains slot state across multiple blocks", () => {
    const harness = createDeckTimelineHarness();
    const { timeline, schedulerConfig, recordedSteps } = harness;

    const blockFrames = 64;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(9),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 256,
      preWarmBlocks: 3,
    };

    scheduleSwap(schedulerConfig, ticket);

    harness.simulateBlock(blockFrames);
    expect(timeline.hotswapSlot.hasState).toBe(true);
    expect(timeline.hotswapSlot.state?.ticket.ticketId).toBe(ticket.ticketId);

    harness.simulateBlock(blockFrames);
    expect(timeline.hotswapSlot.hasState).toBe(true);

    harness.simulateBlock(blockFrames);
    expect(timeline.hotswapSlot.hasState).toBe(true);

    harness.runUntilSwapComplete(blockFrames, 50);

    const finalStep = recordedSteps[recordedSteps.length - 1];
    expect(finalStep?.decision.status.phase).toBe("idle");
  });
});

// Back-to-back swaps: "cancel by replacement" pattern
// Per TLA+ spec, this is the cancellation mechanism—issue a new swap to
// replace the in-flight one. At 4 swaps/second, this is viable for real DJ use.
describe("deck timeline integration: back-to-back swaps", () => {
  it("replaces in-flight swap with new swap (cancel-by-replacement)", () => {
    const harness = createDeckTimelineHarness();
    const { timeline, schedulerConfig, recordedSteps } = harness;

    const blockFrames = 64;

    const ticketAtoB: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(100),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 256,
      preWarmBlocks: 4,
    };

    scheduleSwap(schedulerConfig, ticketAtoB);

    harness.simulateBlock(blockFrames);
    harness.simulateBlock(blockFrames);
    harness.simulateBlock(blockFrames);

    const midSwapStep = recordedSteps[recordedSteps.length - 1];
    expect(midSwapStep?.decision.status.phase).toBe("prewarm");
    expect(timeline.hotswapSlot.state?.ticket.ticketId).toBe(
      ticketAtoB.ticketId,
    );

    const ticketBtoA: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(101),
      engineKind: EngineKind.A,
      atFrame: timeline.frame,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticketBtoA);

    const { completed } = harness.runUntilSwapComplete(blockFrames, 50);
    expect(completed).toBe(true);

    // Protocol must converge back to idle with the replacement ticket's engine active
    const finalStep = recordedSteps[recordedSteps.length - 1];
    expect(finalStep?.decision.status.phase).toBe("idle");
    expect(finalStep?.decision.status.activeEngineKind).toBe(EngineKind.A);

    expect(timeline.hotswapSlot.state?.ticket.ticketId).toBe(
      ticketBtoA.ticketId,
    );
  });

  it("handles rapid successive swaps (stress test at DJ tempo)", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 128;
    const swapCount = 4;

    for (let i = 0; i < swapCount; i++) {
      const ticket: SwapTicketRT<EngineKind> = {
        ticketId: createTicketId(200 + i),
        engineKind: i % 2 === 0 ? EngineKind.B : EngineKind.A,
        atFrame: i * blockFrames * 2,
        fadeFrames: 64,
        preWarmBlocks: 0,
      };

      scheduleSwap(schedulerConfig, ticket);
    }

    const { completed } = harness.runUntilSwapComplete(blockFrames, 100);
    expect(completed).toBe(true);

    const retireSteps = recordedSteps.filter(
      (s) => s.decision.kind === "retireNow",
    );

    expect(retireSteps.length).toBeGreaterThanOrEqual(1);

    // Protocol must converge: no stuck mid-phase
    const finalStep = recordedSteps[recordedSteps.length - 1];
    expect(finalStep?.decision.status.phase).toBe("idle");
  });

  it("replacement during crossfade completes cleanly", () => {
    const harness = createDeckTimelineHarness();
    const { timeline, schedulerConfig, recordedSteps } = harness;

    const blockFrames = 64;

    const ticket1: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(300),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 512,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket1);

    for (let i = 0; i < 5; i++) {
      harness.simulateBlock(blockFrames);
    }

    const crossfadeStep = recordedSteps.find(
      (s) => s.decision.status.phase === "crossfade",
    );
    expect(crossfadeStep).toBeDefined();

    const ticket2: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(301),
      engineKind: EngineKind.A,
      atFrame: timeline.frame,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket2);

    const { completed } = harness.runUntilSwapComplete(blockFrames, 50);
    expect(completed).toBe(true);

    // Protocol must converge: replacement during crossfade still reaches idle
    const finalStep = recordedSteps[recordedSteps.length - 1];
    expect(finalStep?.decision.status.activeEngineKind).toBe(EngineKind.A);
  });
});

// Invalid ticket rejection: defense in depth
// Invalid ticket rejection: defense in depth

describe("deck timeline integration: invalid ticket rejection", () => {
  it("rejects ticket with fadeFrames = 0", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig } = harness;

    const invalidTicket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(10),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 0, // Invalid: must be >= 1
      preWarmBlocks: 0,
    };

    expect(() => {
      scheduleSwap(schedulerConfig, invalidTicket);
    }).toThrow();
  });

  it("rejects ticket with negative preWarmBlocks", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig } = harness;

    const invalidTicket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(20),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: -1, // Invalid: must be >= 0
    };

    expect(() => {
      scheduleSwap(schedulerConfig, invalidTicket);
    }).toThrow();
  });

  it("rejects ticket with ticketId = 0", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig } = harness;

    // Test-only: bypass createTicketId to verify scheduleSwap's own validation
    const invalidTicket: SwapTicketRT<EngineKind> = {
      ticketId: 0 as TicketId,
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    expect(() => {
      scheduleSwap(schedulerConfig, invalidTicket);
    }).toThrow();
  });

  it("createTicketId rejects 0 as reserved", () => {
    expect(() => {
      createTicketId(0);
    }).toThrow();
  });
});

// Additional edge cases

describe("deck timeline integration: additional edge cases", () => {
  it("handles zero-frame segment (command at exact block start)", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 128;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(400),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 128,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);

    harness.simulateBlock(blockFrames);

    const firstBlockSteps = recordedSteps.filter((s) => s.blockIndex === 0);
    expect(firstBlockSteps.length).toBeGreaterThanOrEqual(1);

    const { completed } = harness.runUntilSwapComplete(blockFrames, 50);
    expect(completed).toBe(true);
  });

  it("completes very short swap within single block", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 256;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(401),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 32,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);

    const { completed, blocksRun } = harness.runUntilSwapComplete(
      blockFrames,
      20,
    );
    expect(completed).toBe(true);

    expect(blocksRun).toBeLessThanOrEqual(6);

    const phases = recordedSteps.map((s) => s.decision.status.phase);
    expect(phases).toContain("spawn");
    expect(phases).toContain("retire");

    const finalStep = recordedSteps[recordedSteps.length - 1];
    expect(finalStep?.decision.status.phase).toBe("idle");
  });

  it("handles same-engine swap (A→A re-init scenario)", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 64;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(402),
      engineKind: EngineKind.A,
      atFrame: 0,
      fadeFrames: 64,
      preWarmBlocks: 1,
    };

    scheduleSwap(schedulerConfig, ticket);

    const { completed } = harness.runUntilSwapComplete(blockFrames, 50);
    expect(completed).toBe(true);

    // Should run the full protocol even for same-engine swap
    const phases = recordedSteps.map((s) => s.decision.status.phase);
    expect(phases).toContain("spawn");
    expect(phases).toContain("prime");
    expect(phases).toContain("prewarm");
    expect(phases).toContain("crossfade");
    expect(phases).toContain("retire");

    // Final state should have engine A active (unchanged, but re-initialized)
    const finalStep = recordedSteps[recordedSteps.length - 1];
    expect(finalStep?.decision.status.activeEngineKind).toBe(EngineKind.A);
  });

  it("maintains progress in [0, 1] bounds throughout swap", () => {
    const harness = createDeckTimelineHarness();
    const { schedulerConfig, recordedSteps } = harness;

    const blockFrames = 64;
    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(403),
      engineKind: EngineKind.B,
      atFrame: 0,
      fadeFrames: 192,
      preWarmBlocks: 3,
    };

    scheduleSwap(schedulerConfig, ticket);

    harness.runUntilSwapComplete(blockFrames, 50);

    for (const step of recordedSteps) {
      const progress = step.decision.status.progress;
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }

    const activeSteps = recordedSteps.filter(
      (s) => s.decision.status.phase !== "idle",
    );
    let lastProgress = 0;
    for (const step of activeSteps) {
      expect(step.decision.status.progress).toBeGreaterThanOrEqual(
        lastProgress,
      );
      lastProgress = step.decision.status.progress;
    }
  });

  it("handles multiple commands at same frame with different priorities", () => {
    const harness = createDeckTimelineHarness();
    const { pendingRTCommands, schedulerConfig, recordedCommands, timeline } =
      harness;

    const blockFrames = 128;

    const ticket: SwapTicketRT<EngineKind> = {
      ticketId: createTicketId(404),
      engineKind: EngineKind.B,
      atFrame: 64,
      fadeFrames: 64,
      preWarmBlocks: 0,
    };

    scheduleSwap(schedulerConfig, ticket);

    // Add a non-mailbox command (stop) at the same frame to test priority ordering
    // The installSwap comes from mailbox drain, stopCmd is pushed directly
    const stopCmd: TimelineCommand<EngineKind> = {
      atFrame: 64,
      priority: 10,
      payload: { kind: "stop" },
    };
    pendingRTCommands.push(stopCmd);

    harness.simulateBlock(blockFrames);

    expect(recordedCommands).toHaveLength(2);
    // installSwap has priority 0 (from mailbox projection), stop has priority 10
    expect(recordedCommands[0]?.command.payload.kind).toBe("installSwap");
    expect(recordedCommands[1]?.command.payload.kind).toBe("stop");

    // Timeline should be stopped (stop command applied after installSwap)
    expect(timeline.isPlaying).toBe(false);
  });
});
