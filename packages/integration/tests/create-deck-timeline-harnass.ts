import { createCommandMailbox } from "@seqlok/commands";
import {
  createHotswapCommandCodec,
  HOTSWAP_COMMAND_TAG_INSTALL,
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  type HotswapCommand,
  type SwapStepDecisionRT,
  type SwapTicketRT,
} from "@seqlok/hotswap";
import { type SwsrRingLayout } from "@seqlok/primitives";

import {
  createHotswapSlotDriver,
  createSlicerState,
  type HotswapSchedulerConfig,
  processTimelineBlock,
  type TimelineCommand,
  type TimelineDriver,
  type TimelineProcessCallbacks,
} from "../src";

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
export function createDeckTimelineHarness(): DeckTimelineHarness {
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
