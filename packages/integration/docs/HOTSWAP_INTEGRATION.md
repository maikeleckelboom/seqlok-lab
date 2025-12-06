# Deck Hot-Swap Integration (Canonical Flow)

This documents the end-to-end path a typical "deck" uses to install and run an engine hot-swap. The integration test
at [`tests/deck.timeline.integration.test.ts`](../tests/deck.timeline.integration.test.ts) serves as the executable
specification for this flow.

## Overview

```
scheduleSwap → mailbox (SWSR ring) → RT drain → TimelineCommand → processTimelineBlock → HotswapSlotDriver.stepBlock → decisions
```

## 1. Host Side (Non-RT)

### Construct a swap ticket

```ts
import {
  createTicketId,
  type SwapTicketRT,
} from "@seqlok/hotswap";

const ticket: SwapTicketRT<EngineKind> = {
  ticketId: createTicketId(1),  // Unique, non-zero ticket identifier
  engineKind: EngineKind.B,     // Target engine to swap to
  atFrame: 256,                 // Absolute frame on the deck's timeline
  fadeFrames: 256,              // Crossfade duration in frames
  preWarmBlocks: 2,             // Blocks to run both engines before crossfade
};
```

### Configure and call scheduleSwap

```ts
import {createCommandMailbox} from "@seqlok/commands";
import {
  createHotswapCommandCodec,
  HOTSWAP_COMMAND_TAG_INSTALL,
  HOTSWAP_COMMAND_WORDS_PER_SLOT,
  type HotswapCommand,
} from "@seqlok/hotswap";
import {
  scheduleSwap,
  type HotswapSchedulerConfig,
} from "@seqlok/integration";

const codec = createHotswapCommandCodec<EngineKind>();
const mailbox = createCommandMailbox<HotswapCommand<EngineKind>>({
  mailboxId: "deck-0",
  codec,
  layout: {
    capacity: 16,
    wordsPerSlot: HOTSWAP_COMMAND_WORDS_PER_SLOT,
  },
});

const schedulerConfig: HotswapSchedulerConfig<
  EngineKind,
  HotswapCommand<EngineKind>
> = {
  mailboxId: "deck-0",
  producer: mailbox.producer,
  encodeInstallSwap(ticket) {
    return {tag: HOTSWAP_COMMAND_TAG_INSTALL, ticket};
  },
};

scheduleSwap(schedulerConfig, ticket);
```

`scheduleSwap` validates the ticket using the RT protocol and enqueues a `HotswapCommand` into the deck's
`CommandMailbox`. Invalid tickets are rejected before they hit the RT path.

## 2. RT Side (Per Audio Block)

### Deck state

Each deck owns:

```ts
import {
  createHotswapSlotDriver,
  createSlicerState,
  type TimelineCommand,
  type TimelineDriver,
} from "@seqlok/integration";

const hotswapSlot = createHotswapSlotDriver<EngineKind>();
const timeline: TimelineDriver<EngineKind> = {
  frame: 0,
  isPlaying: true,
  slicer: createSlicerState<TimelineCommand<EngineKind>>(),
  hotswapSlot,
};

// Pending RT commands queue.
// Normally fed only by mailbox.consumer.drain (installSwap), but other
// command types may be pushed directly.
const pendingRTCommands: TimelineCommand<EngineKind>[] = [];

let activeEngineKind: EngineKind = EngineKind.A;
```

### Per-block processing

```ts
import {
  processTimelineBlock,
  type TimelineProcessCallbacks,
} from "@seqlok/integration";

function processAudioBlock(blockFrames: number): void {
  // 1. Drain mailbox and project HotswapCommand → TimelineCommand
  mailbox.consumer.drain({
    onCommand(command: HotswapCommand<EngineKind>) {
      const {ticket} = command;
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

  // 2. Collect commands that fire this block
  const blockStart = timeline.frame;
  const blockEnd = blockStart + blockFrames;
  const drainedCommands: TimelineCommand<EngineKind>[] = [];

  for (let i = pendingRTCommands.length - 1; i >= 0; i -= 1) {
    const cmd = pendingRTCommands[i];
    if (cmd !== undefined && cmd.atFrame < blockEnd) {
      drainedCommands.push(cmd);
      pendingRTCommands.splice(i, 1);
    }
  }

  drainedCommands.sort((a, b) => {
    if (a.atFrame !== b.atFrame) return a.atFrame - b.atFrame;
    return a.priority - b.priority;
  });

  // 3. Process block with callbacks
  const callbacks: TimelineProcessCallbacks<EngineKind> = {
    renderSegment(frames) {
      const nextKind: EngineKind = hotswapSlot.hasState
        ? (hotswapSlot.state?.ticket.engineKind ?? EngineKind.None)
        : EngineKind.None;

      const decision = hotswapSlot.stepBlock(
        frames,
        activeEngineKind,
        nextKind,
        EngineKind.None,
      );

      // Apply decision to engine bank (see below)
      applyDecisionToEngines(decision, frames);

      if (decision.kind === "retireNow") {
        activeEngineKind = nextKind;
      }
    },
    applyCommandSideEffects(cmd) {
      // Called at exact segment boundaries when a TimelineCommand applies.
      // For "installSwap" this installs the ticket into hotswapSlot.
    },
  };

  processTimelineBlock(timeline, blockFrames, drainedCommands, callbacks);
}
```

## 3. Engine Application

The integration test only records `SwapStepDecisionRT<EngineKind>` values. A real deck replaces that recording with
calls into its engine bank:

```ts
interface EngineInstance {
  render(dst: Float32Array, frames: number): void;
}

interface EngineBank<EngineKind extends number> {
  get(kind: EngineKind): EngineInstance | null;
}

function applyDecisionToEngines(
  decision: SwapStepDecisionRT<EngineKind>,
  frames: number,
): void {
  const current = bank.get(decision.status.activeEngineKind);
  const next = bank.get(decision.status.nextEngineKind);

  switch (decision.kind) {
    case "idle":
    case "runCurrentOnly":
      // Render only current engine at full gain
      current?.render(outputBuffer, frames);
      break;

    case "runCurrentAndPrewarmNext":
      // Render current at full gain, prewarm next (discard output)
      current?.render(outputBuffer, frames);
      next?.render(scratchBuffer, frames);
      break;

    case "runBothForCrossfade":
      // Render both and mix using decision.status.currentGain / nextGain
      current?.render(currentBuffer, frames);
      next?.render(nextBuffer, frames);
      mixBuffers(
        outputBuffer,
        currentBuffer,
        nextBuffer,
        decision.status.currentGain,
        decision.status.nextGain,
        frames,
      );
      break;

    case "retireNow":
      // Final crossfade block, then switch active engine
      current?.render(currentBuffer, frames);
      next?.render(nextBuffer, frames);
      mixBuffers(
        outputBuffer,
        currentBuffer,
        nextBuffer,
        decision.status.currentGain,
        decision.status.nextGain,
        frames,
      );
      // After this, activeEngineKind switches to next
      break;
  }
}
```

## Protocol Guarantees

The hot-swap protocol (formally verified via TLA+) guarantees:

- **At most 2 engines active** per slot (current + next)
- **Eventual idle**: Any accepted swap eventually reaches `phase: "idle"`
- **No audio gap**: During crossfade, both engines render every block
- **Monotonic progress**: Progress value never decreases during a swap
- **Cancellation via replacement**: Issue a new swap to cancel an in-flight one

## Test Coverage

The integration test suite covers:

- **Happy path**: Full swap lifecycle (spawn → prime → prewarm → crossfade → retire → idle)
- **Immediate swap**: atFrame = 0 with no prewarm
- **Multi-block crossfade**: fadeFrames spanning multiple blocks
- **Back-to-back swaps**: Cancel-by-replacement pattern
- **Invalid tickets**: Defense-in-depth validation
- **Edge cases**: Late commands, zero-frame segments, same-engine swaps

See [`tests/deck.timeline.integration.test.ts`](../tests/deck.timeline.integration.test.ts) for the executable
specification.
