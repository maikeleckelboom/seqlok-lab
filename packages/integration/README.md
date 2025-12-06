## Deck hot-swap integration

The `@seqlok/integration` package ships the canonical “deck hot-swap” flow as both:

- A human-readable design doc: [`docs/HOTSWAP_INTEGRATION.md`](./docs/HOTSWAP_INTEGRATION.md)
- An executable specification: [`tests/deck.timeline.integration.test.ts`](./tests/deck.timeline.integration.test.ts)

At a high level, a swap flows through:

```text
scheduleSwap
  → CommandMailbox (SWSR ring)
  → RT drain (per deck)
  → TimelineCommand queue
  → processTimelineBlock
  → HotswapSlotDriver.stepBlock
  → SwapStepDecisionRT<EngineKind>
````

On the **host side**, you:

* Construct a `SwapTicketRT<EngineKind>` (non-zero `ticketId`, `engineKind`, `atFrame`, `fadeFrames`, `preWarmBlocks`)
* Configure a `HotswapSchedulerConfig<EngineKind, HotswapCommand<EngineKind>>`
* Call `scheduleSwap(config, ticket)` to validate and enqueue a `HotswapCommand` into the deck’s `CommandMailbox`

On the **RT side**, each deck:

* Drains its mailbox into `TimelineCommand<EngineKind>` values (`kind: "installSwap"` for new tickets)
* Runs `processTimelineBlock(timeline, blockFrames, commands, callbacks)`
* Inside `renderSegment`, calls `hotswapSlot.stepBlock(...)` and applies the resulting
  `SwapStepDecisionRT<EngineKind>` to its engine bank (current / next / crossfade / retire)

See `docs/HOTSWAP_INTEGRATION.md` for code-level examples and protocol guarantees,
and `tests/deck.timeline.integration.test.ts` for a full end-to-end test that stitches
together `scheduleSwap`, the SWSR mailbox, the timeline slicer, and `HotswapSlotDriver`.

