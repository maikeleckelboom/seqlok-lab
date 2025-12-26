# @seqlok/hotswap Implementation Guide

## Overview

This document describes how to implement a conformant driver for the `@seqlok/hotswap` protocol. The protocol is defined
by:

1. **TLA+ Specifications** (`HotSwapSingle.tla`, `HotSwapRejectBusy.tla`) — formal sources of truth
2. **TypeScript Reference** (TypeScript implementation under `src/`) — canonical implementation
3. **This Guide** — integration patterns and caller responsibilities

The protocol is intentionally minimal. It tracks *phase* and *counters*. Everything else — engines, buffers, crossfade
curves, memory management — is the caller’s responsibility.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [State Machine Reference](#state-machine-reference)
3. [Caller Responsibilities by Phase](#caller-responsibilities-by-phase)
4. [Memory Ordering Contract](#memory-ordering-contract)
5. [Ticket Delivery Pattern](#ticket-delivery-pattern)
6. [Crossfade Curve Implementation](#crossfade-curve-implementation)
7. [Integration with Seqlok Meters](#integration-with-seqlok-meters)
8. [Error Handling and Edge Cases](#error-handling-and-edge-cases)
9. [Testing Strategy](#testing-strategy)
10. [C++ Implementation Notes](#c-implementation-notes)

---

## Core Concepts

### The Slot Abstraction

A slot is a logical container that holds:

- Exactly one **current engine** (always present, produces output)
- At most one **next engine** (present only during swap)

The protocol guarantees: **at most two engines are ever instantiated per slot**.

### What the Protocol Does

- Tracks which **phase** a swap is in.
- Counts down **prewarm blocks** and **fade frames**.
- Emits a small enum (`SwapStepKind`) describing what work to do for the current block.

### What the Protocol Does *Not* Do

- Construct or destroy engines.
- Process audio samples.
- Blend signals or define crossfade curves.
- Manage memory or engine pooling.
- Enforce musical timing (`atFrame` is informational).

All of those are delegated to the host/integration layer.

---

## State Machine Reference

High-level phase diagram:

```text
                          AcceptTicket
    ┌───────┐         (ticket + next engine ready)        ┌───────┐
    │ idle  │ ────────────────────────────────────────────▶ spawn │
    └───────┘                                             └───────┘
        ▲                                                     │
        │                                               stepSwapStateRT
        │                                                     │
        │                                                     ▼
        │                                                ┌───────┐
        │                                                │ prime │
        │                                                └───────┘
        │                                                     │
        │                              ┌──────────────────────┴──────────────────────┐
        │                              │                                             │
        │                              ▼ (prewarm > 0)                               ▼ (prewarm = 0)
        │                        ┌─────────┐                                   ┌───────────┐
        │                        │ prewarm │──────────────────────────────────▶│ crossfade │
        │                        └─────────┘                                   └───────────┘
        │                              │ (prewarmRemaining hits 0)                  │
        │                              └────────────────────────────────────────────┘
        │                                                                            │
        │                                                                            ▼
        │                                                                      ┌─────────┐
        └──────────────────────────────────────────────────────────────────────│ retire  │
                                                                               └─────────┘
````

### Phase Durations

| Phase       | Duration   | Notes                                 |
|-------------|------------|---------------------------------------|
| `idle`      | Indefinite | Waiting for swap request              |
| `spawn`     | 1 block    | Next engine exists, not yet processed |
| `prime`     | 1 block    | Next engine’s first `process()` call  |
| `prewarm`   | N blocks   | `N = ticket.preWarmBlocks`            |
| `crossfade` | M blocks   | Until `fadeFramesRemaining <= 0`      |
| `retire`    | 1 block    | Final block before handle swap        |

The TLA⁺ specifications model these phases as discrete actions; the TypeScript/C++ implementations follow the same
structure.

---

## Caller Responsibilities by Phase

Each block, the driver calls a function like:

```ts
const decision = stepSwapStateRT(state, blockFrames, activeKind, nextKind, noneKindSentinel);
```

The `decision.kind` tells the caller what to do.

### `idle` → No active swap

```ts
// SwapStepKind: 'idle'
//
// Caller MUST:
//   - Run current engine normally.
//   - Poll for incoming tickets (from integration thread).
//
// Caller MAY:
//   - Do nothing special beyond normal audio processing.
```

### `spawn` → Next engine just instantiated

```ts
// SwapStepKind: 'runCurrentOnly'
//
// Caller MUST:
//   - Run current engine, use its output.
//   - NOT call process() on next engine yet.
//
// Caller MAY:
//   - Perform any final initialization on next engine.
//
// Duration: exactly 1 block.
```

### `prime` → Next engine’s first process

```ts
// SwapStepKind: 'runCurrentOnly'
//
// Caller MUST:
//   - Run current engine, use its output.
//   - Run next engine's process() once (output discarded).
//
// Rationale: allows next engine to fill delay lines, initialize filters, etc.
//
// Duration: exactly 1 block.
```

### `prewarm` → Warming up next engine

```ts
// SwapStepKind: 'runCurrentAndPrewarmNext'
//
// Caller MUST:
//   - Run current engine, use its output.
//   - Run next engine's process() (output discarded).
//
// Rationale: time-domains effects (reverb, lookahead, FIR filters) need multiple
// blocks to reach a stable state before their output sounds correct.
//
// Duration: ticket.preWarmBlocks blocks.
```

### `crossfade` → Both engines producing output

```ts
// SwapStepKind: 'runBothForCrossfade'
//
// Caller MUST:
//   - Run current engine, capture output (outA).
//   - Run next engine, capture output (outB).
//   - Blend: out = outA * fadeOut + outB * fadeIn.
//   - Compute fade weights from fadeFramesRemaining / totalFadeFrames.
//
// Duration: approximately ceil(ticket.fadeFrames / blockFrames) blocks.
```

### `retire` → Crossfade complete

```ts
// SwapStepKind: 'retireNow'
//
// Caller MUST:
//   - Run current engine ONE FINAL TIME (output used).
//   - After processing this block: swap engine handles (next -> current).
//   - After processing this block: arrange for the retiring engine to be
//     reclaimed on a non-RT thread, with a suitable memory barrier.
//
// Duration: exactly 1 block, then back to idle.
```

---

## Memory Ordering Contract

When `retireNow` is returned, the driver must ensure:

1. All writes performed by the retiring engine become visible before reclamation.
2. The host thread does not destroy or recycle the engine until that visibility is guaranteed.

### Native (C++)

```cpp
void onRetireNow() {
    // 1. Final block from current engine
    currentEngine->process(buffer);

    // 2. Publish all writes before handing engine to another thread
    std::atomic_thread_fence(std::memory_order_release);

    // 3. Swap handles
    Engine* old = currentEngine;
    currentEngine = nextEngine;
    nextEngine = nullptr;

    // 4. Signal reclamation on a non-RT thread
    retireQueue.push(old);
}
```

### Web Audio (AudioWorklet)

```ts
function onRetireNow() {
  // 1. Final process
  this.currentEngine.process(buffer);

  // 2. Release-style store to shared status
  Atomics.store(this.statusView, STATUS_OFFSET, RETIRED);

  // 3. Swap handles
  const old = this.currentEngine;
  this.currentEngine = this.nextEngine;
  this.nextEngine = null;

  // 4. Notify main thread
  this.port.postMessage({type: "retired", handle: old.id});
}
```

Implementations must avoid allocations, locks, and syscalls on the RT path.

---

## Ticket Delivery Pattern

Tickets are built on a host/integration thread and delivered to the RT thread via a lock-free channel (e.g. SPSC ring).

Conceptual flow:

```text
Host thread                                   RT thread
-----------                                   ---------
1. Build ticket + engine instance       ─▶   4. Dequeue command
2. Enqueue command (lock-free)          ─▶   5. Copy ticket into RT state
                                             6. Call initSwapStateRT
```

### Command shape (RT-safe)

```ts
interface InstallSwapCommand<EngineKind extends number> {
  readonly tag: 1; // discriminant
  readonly engineHandle: number; // index into preallocated engine table
  readonly ticket: SwapTicketRT<EngineKind>; // POD, copied by value
}
```

The host can maintain a richer ticket type; only the RT subset (`SwapTicketRT`) crosses into the RT domain.

---

## Crossfade Curve Implementation

The protocol exposes `fadeFramesRemaining` and `totalFadeFrames`. The curve itself is policy.

### Linear crossfade

```ts
function linearFade(state: SwapStateRT<number>): { fadeIn: number; fadeOut: number } {
  const t = 1 - state.fadeFramesRemaining / state.totalFadeFrames;
  return {fadeIn: t, fadeOut: 1 - t};
}
```

### Equal-power crossfade (recommended for audio)

```ts
function equalPowerFade(state: SwapStateRT<number>): { fadeIn: number; fadeOut: number } {
  const t = 1 - state.fadeFramesRemaining / state.totalFadeFrames;
  return {
    fadeIn: Math.sin(t * Math.PI * 0.5),
    fadeOut: Math.cos(t * Math.PI * 0.5),
  };
}
```

### Per-sample fading within a block

```ts
function processCrossfadeBlock(
  outA: Float32Array,
  outB: Float32Array,
  dest: Float32Array,
  fadeFramesStart: number,
  totalFadeFrames: number,
  blockFrames: number,
): void {
  for (let i = 0; i < blockFrames; i++) {
    const framesRemaining = Math.max(0, fadeFramesStart - i);
    const t = 1 - framesRemaining / totalFadeFrames;
    const fadeIn = Math.sin(t * Math.PI * 0.5);
    const fadeOut = Math.cos(t * Math.PI * 0.5);
    dest[i] = outA[i] * fadeOut + outB[i] * fadeIn;
  }
}
```

---

## Integration with Seqlok Meters

The swap state can be exposed to the UI via Seqlok meters.

Example spec:

```ts
const swapMeterSpec = defineSpec({
  meters: {
    phase: {kind: "u32"},          // encoded SwapPhase
    ticketId: {kind: "u32"},
    progress: {kind: "f32"},
    activeEngineKind: {kind: "u32"},
    nextEngineKind: {kind: "u32"},
  },
});
```

RT side:

```ts
processor.meters.phase = phaseToU32(status.phase);
processor.meters.ticketId = status.ticketId;
processor.meters.progress = status.progress;
processor.meters.activeEngineKind = status.activeEngineKind;
processor.meters.nextEngineKind = status.nextEngineKind;
```

Host/UI side reads snapshots for display.

---

## Error Handling and Edge Cases

* `fadeFrames = 0`
  Not allowed by the spec; treated as invalid input. Implementations should assert or reject such tickets.

* `preWarmBlocks = 0`
  Legal; the protocol goes `prime → crossfade` immediately.

* Ticket arrives during active swap
  Base protocol is single-swap; multi-swap policy is handled separately (e.g. reject-while-busy or queuing).

* Cancellation mid-swap
  Not part of the base contract. Adding cancellation requires extending both implementation and TLA⁺ specs.

---

## Testing Strategy

* Unit tests for `stepSwapStateRT` across all phases.
* Property tests mirroring TLA⁺ invariants (e.g. “eventually idle”, “at most two engines”).
* Cross-language conformance tests with JSON test vectors shared between TypeScript and C++ implementations.

---

## C++ Implementation Notes

The C++ API mirrors the TS contracts with templates instead of generics and sentinel values instead of `undefined`. The
same restrictions apply: no allocation, no locks, deterministic control flow.

---

## Version History

| Version | Changes                                             |
|--------:|-----------------------------------------------------|
|   0.1.0 | Initial protocol. No cancellation, no queued swaps. |
