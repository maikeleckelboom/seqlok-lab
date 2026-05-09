# ADR-010: Ring Primitive Ownership and Stack Position

**Status**: Accepted
**Date**: 2025-11-19
**Revised**: 2026-05-09
**Owner**: _TBD_

**Related**:

- ADR-001 – Seqlok Core Canonical Flow
- ADR-002 – Memory Growth & Swap via Handoff Sequences
- ADR-011 – MWMR Ground Truth

---

## 1. What is the primitive?

The **SWSR (single-writer, single-reader) ring primitive** provides:

- A fixed-size queue over `SharedArrayBuffer` or shared `WebAssembly.Memory`,
- Lock-free, wait-free enqueue for the producer,
- Lock-free, wait-free dequeue for the consumer,
- Drop-newest-on-full overflow policy (configurable),
- Zero allocations in the hot path.

It is the foundational transport primitive for:

- **Commands** – discrete intent (seek, trigger, swap),
- **Streams** – bulk data (PCM, byte streams, frame sequences).

---

## 2. Which package owns it?

**`@seqlok/primitives`** owns the low-level SWSR ring primitive.

Public surface (from `@seqlok/primitives`):

```ts
// Allocation
export function allocateSwsrRing(layout: SwsrRingLayout): SwsrRingBacking;

// Binding
export function bindSwsrRingProducer<T>(backing: SwsrRingBacking, encode: SwsrRingEncode<T>): SwsrRingProducer<T>;
export function bindSwsrRingConsumer<T>(backing: SwsrRingBacking, decode: SwsrRingDecode<T>): SwsrRingConsumer<T>;

// Header layout constants
export const SWSR_HEADER_WORDS: number;
export const SWSR_HEADER_READ_INDEX: number;
export const SWSR_HEADER_WRITE_INDEX: number;
export const SWSR_HEADER_WRITE_SEQ: number;
export const SWSR_HEADER_DROPPED: number;
```

Header fields (conceptual, ABI-stable):

```txt
u32[0]  writeIndex     // next slot index for producer
u32[1]  readIndex      // next slot index for consumer
u32[2]  writeSeq       // monotonic sequence for diagnostics
u32[3]  dropped        // cumulative dropped count (overflow)
u32[4..15] reserved    // future-proofing
```

This package is **schema-free** and **semantic-free**. It provides mechanisms (atomics, rings, memory helpers), not
product meaning.

---

## 3. What higher layers are built on top?

### 3.1 Typed command transport – `@seqlok/commands`

Built on the primitive ring, `@seqlok/commands` provides:

- `CommandCodec<C>` – encodes/decodes discriminated unions into fixed-width slots,
- `createCommandMailbox(...)` – allocates ring + returns `{ producer, consumer }`,
- `createCommandBus(...)` – fan-in over multiple consumers.

This is where **semantics** arrive: command schemas, opcodes, bus topology.

### 3.2 Bulk stream transport – `@seqlok/streambuf`

For PCM, byte streams, frame sequences. Uses the same primitive ring with different encoding strategies (chunked,
streaming, circular).

### 3.3 Core state model – `@seqlok/core`

`@seqlok/core` uses the ring primitive **only where needed** for:

- Internal handoff protocol metadata (not public API),
- Future internal transport (if any).

Core **does not** re-export the primitive. If you need rings, you import `@seqlok/primitives` or higher layers.

---

## 4. Usage flow

```ts
import {
  allocateSwsrRing,
  bindSwsrRingProducer,
  bindSwsrRingConsumer,
} from "@seqlok/primitives";

// 1. Allocate
const backing = allocateSwsrRing({ capacity: 256, wordsPerSlot: 4 });

// 2. Bind producer + consumer (typically on different threads)
const producer = bindSwsrRingProducer(backing, {
  encode(command, dst, wordOffset) { /* write 4 words */ }
});

const consumer = bindSwsrRingConsumer(backing, {
  decode(src, wordOffset) { /* read 4 words */ }
});

// 3. Use
producer.enqueue({ /* ... */ });
consumer.drain((cmd) => { /* ... */ });
```

Higher layers (`@seqlok/commands`) wrap this into typed mailboxes and buses.

---

## 5. What does it explicitly not own?

| Concern | Owner | Not in `@seqlok/primitives` |
|---------|-------|------------------------------|
| Param/meter semantics | `@seqlok/core` | No spec, plan, or binding logic |
| Typed command codecs | `@seqlok/commands` | No `CommandCodec`, mailbox, bus |
| Stream framing | `@seqlok/streambuf` | No chunking, flow control |
| Telemetry schemas | `@seqlok/diagnostics` | No snapshot formats |
| Tooling/analysis | `@seqlok/introspect` | No counters, health checks |
| Orchestration | Host/product code | No topology, scheduling, drivers |

Primitives stay at the mechanism level. Meaning arrives in higher packages.

---

## 6. Cross-runtime interop

The header layout is ABI-stable and trivial to mirror:

```cpp
// C++
struct alignas(64) SwsrHeader {
    std::atomic<std::uint32_t> writeIndex;
    std::atomic<std::uint32_t> readIndex;
    std::atomic<std::uint32_t> writeSeq;
    std::atomic<std::uint32_t> dropped;
    std::uint32_t reserved[12];
};
```

- JS via `Uint32Array`
- C++ via `std::atomic` fields
- Same `capacity` × `wordsPerSlot` produces identical layouts

This enables mixed JS/Wasm/C++ systems sharing the same control plane.

---

## 7. Summary

| Layer | Package | Role |
|-------|---------|------|
| **Primitive** | `@seqlok/primitives` | SWSR ring allocation + bind |
| **Command semantics** | `@seqlok/commands` | Typed mailboxes, buses |
| **Stream semantics** | `@seqlok/streambuf` | Bulk transfer |
| **State engine** | `@seqlok/core` | Spec, plan, backing, handoff, bindings |
| **Telemetry** | `@seqlok/diagnostics` | RT-safe schemas, SAB rings |
| **Analysis** | `@seqlok/introspect` | Health, counters, tooling |

**Key decision:** The ring primitive lives in `@seqlok/primitives`, not `@seqlok/core`. Core focuses on the
spec-to-binding lifecycle; primitives provides the substrate.

This ADR is the normative source for:

- Package ownership of the SWSR ring primitive (`@seqlok/primitives`),
- Layering: primitives → commands/streambuf → core state model,
- ABI contract for cross-runtime interop.
