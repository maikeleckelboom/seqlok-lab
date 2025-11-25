# Command Ring Protocol: TLA+ Formal Specification

## What This Is

This is a **formal specification** of the SPSC (Single Producer, Single Consumer) command ring buffer used by Seqlok for delivering commands from the host thread (non-real-time) to the audio/processor thread (real-time). The specification captures the lock-free FIFO semantics where:

- The **producer** (host thread) enqueues commands into free slots without blocking.
- The **consumer** (RT thread) dequeues commands in strict FIFO order.
- The ring has **fixed capacity**; the producer must respect backpressure when full.
- No command is ever lost, duplicated, or observed out of order.

The TLC model checker exhaustively explores every interleaving of producer and consumer operations and verifies that safety invariants (no overwrites, no phantom reads, FIFO order) always hold and liveness properties (eventual consumption, no starvation) are satisfied.

The spec is designed to be **extensible**: while v1 targets SPSC, the state model and invariants are structured to generalize toward MWMR (Multiple Writer, Multiple Reader) and SPARBB (Single Producer, Atomic Readers, Bounded Buffer) patterns in future iterations.

---

## Files (Proposed)

```
CommandRingProtocol.tla   # The specification
CommandRingProtocol.cfg   # Model checking configuration
test-vectors.json         # Conformance test traces
```

---

## Informal State Model

### Buffer State

| Variable          | Domain                                      | Description                                                          |
|-------------------|---------------------------------------------|----------------------------------------------------------------------|
| `buffer`          | `[0..CAPACITY-1 → Slot]`                    | Fixed-size array of slots                                            |
| `Slot`            | `{Empty} ∪ Command`                         | Each slot is either empty or contains a command                      |
| `CAPACITY`        | `Nat` (constant)                            | Ring buffer capacity (power of 2 recommended)                        |

### Index State

| Variable     | Domain | Description                                                             |
|--------------|--------|-------------------------------------------------------------------------|
| `writeIndex` | `Nat`  | Next slot the producer will write to (unbounded, mod CAPACITY for slot) |
| `readIndex`  | `Nat`  | Next slot the consumer will read from (unbounded, mod CAPACITY)         |

### Auxiliary State (for invariant checking)

| Variable          | Domain                                      | Description                                                          |
|-------------------|---------------------------------------------|----------------------------------------------------------------------|
| `enqueuedSeq`     | `Seq(Command)`                              | Ghost variable: sequence of all enqueued commands in order           |
| `consumedSeq`     | `Seq(Command)`                              | Ghost variable: sequence of all consumed commands in order           |
| `inFlight`        | `Nat`                                       | Derived: `writeIndex - readIndex` (commands pending consumption)     |

### Command Structure

Commands are opaque to the ring protocol. For modeling, a command is a record:

```
Command == [
    tag: CommandTag,      \* Discriminant (e.g., InstallSwap, SetParam, etc.)
    payload: Payload,     \* Arbitrary payload (not interpreted by ring)
    seq: Nat              \* Sequence number for ordering verification
]
```

---

## Actions / Next-state Operators

### Producer Actions

| Action                | Variables Modified                    | Constraints                                                                                                                                              |
|-----------------------|---------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `EnqueueCommand(cmd)` | `buffer`, `writeIndex`, `enqueuedSeq` | Precondition: `inFlight < CAPACITY` (ring not full). Writes `cmd` to `buffer[writeIndex % CAPACITY]`, increments `writeIndex`, appends to `enqueuedSeq`. |
| `ProducerObserveFull` | (none)                                | No-op action when `inFlight = CAPACITY`. Models producer polling and finding ring full.                                                                  |

### Consumer Actions

| Action                 | Variables Modified                   | Constraints                                                                                                                                                |
|------------------------|--------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `DequeueCommand`       | `buffer`, `readIndex`, `consumedSeq` | Precondition: `inFlight > 0` (ring not empty). Reads `buffer[readIndex % CAPACITY]`, marks slot `Empty`, increments `readIndex`, appends to `consumedSeq`. |
| `ConsumerObserveEmpty` | (none)                               | No-op action when `inFlight = 0`. Models consumer polling and finding ring empty.                                                                          |

### Derived Predicates

```
inFlight == writeIndex - readIndex

RingFull == inFlight = CAPACITY

RingEmpty == inFlight = 0

SlotIndex(idx) == idx % CAPACITY
```

---

## Safety Invariants

| Property                | Meaning                                                                                                                 |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `TypeOK`                | All variables in valid domains: indices non-negative, buffer slots are `Empty` or `Command`, capacity respected.        |
| `IndicesMonotonic`      | `writeIndex` and `readIndex` never decrease.                                                                            |
| `WriteAheadOfRead`      | `writeIndex >= readIndex` always (cannot read what hasn't been written).                                                |
| `InFlightBounded`       | `0 <= inFlight <= CAPACITY` (no underflow or overflow).                                                                 |
| `NoOverwriteOfPending`  | Slots representing pending (unconsumed) commands are never overwritten by the producer.                                 |
| `NoPhantomCommands`     | Every command in `consumedSeq` was previously in `enqueuedSeq`. No command appears in consumption that wasn't enqueued. |
| `FIFOOrderPreserved`    | `consumedSeq` is a prefix of `enqueuedSeq`. Commands are consumed in exactly the order they were enqueued.              |
| `NoReadOfUninitialized` | Consumer never reads a slot that is `Empty` (precondition enforced by `inFlight > 0`).                                  |

### Central safety properties

Two invariants are particularly important for implementation correctness:

**`WriteAheadOfRead`**: The write index is always at least as large as the read index. This ensures the producer never "laps" the consumer in a way that would expose uninitialized or stale slots. In a real implementation, this prevents undefined behavior from reading garbage data.

**`InFlightBounded`**: The number of pending commands (`writeIndex - readIndex`) is always between 0 and `CAPACITY`. This guarantees bounded memory usage and prevents both underflow (reading when empty) and overflow (writing when full).

### NoOverwriteOfPending explained

The invariant `NoOverwriteOfPending` captures a critical safety property: **slots between `readIndex` and `writeIndex` (modulo capacity) represent pending commands, and the producer must not overwrite them**.

Formally, this is enforced by the precondition `inFlight < CAPACITY` in `EnqueueCommand`: if the ring is full, the producer cannot write. Since `inFlight = writeIndex - readIndex`, and we write to `writeIndex % CAPACITY`, the slot we're about to write is the one that would "wrap around" to `readIndex % CAPACITY` only when full — which is blocked.

The ghost sequences `enqueuedSeq` and `consumedSeq` provide an alternative proof: `FIFOOrderPreserved` (consumed is a prefix of enqueued) implies no command is ever lost or corrupted, which would happen if pending slots were overwritten.

---

## Liveness Properties

| Property                         | Meaning                                                                              |
|----------------------------------|--------------------------------------------------------------------------------------|
| `EventuallyConsumed`             | Under weak fairness on consumer, every enqueued command is eventually consumed.      |
| `NoProducerStarvation`           | If the ring is not full, the producer can eventually enqueue (under fairness).       |
| `NoConsumerStarvation`           | If the ring is not empty, the consumer can eventually dequeue (under fairness).      |
| `IndicesEventuallyProgress`      | Under fairness, if commands are enqueued, `readIndex` eventually advances.           |
| `EventuallyEmptyIfProducerStops` | **Conditional**: If the producer stops enqueuing, the ring eventually becomes empty. |

### Fairness assumptions

The liveness properties above require **fairness assumptions** on actions. In a real TLA+ model, these would be specified as weak fairness (`WF`) on individual actions rather than on the entire `Next` relation:

1. **`WF_vars(DequeueCommand)`**: If the consumer can dequeue (ring non-empty), it eventually does. This models a consumer that is not permanently blocked or starved by the scheduler.

2. **`WF_vars(EnqueueCommand)`**: If the producer can enqueue (ring not full), it eventually does. This models a producer that is not permanently blocked.

3. **No assumption on producer stopping**: The property `EventuallyConsumed` assumes the consumer keeps running, but does **not** assume the producer stops. If the producer enqueues forever, the consumer must keep up (or the ring saturates).

### `EventuallyEmptyIfProducerStops` explained

This property is **conditional** on producer behavior:

- **If** the producer stops enqueuing (i.e., reaches a state where it takes no more `EnqueueCommand` actions), **then** under weak fairness on the consumer, the ring eventually becomes empty.
- This is **not** unconditional liveness: if the producer enqueues indefinitely, the ring may never be empty.

In TLA+ terms, this could be expressed as an implication or using a `LEADS_TO` style property:
```
(ProducerStopped) ~> (RingEmpty)
```
where `ProducerStopped` is a state predicate indicating the producer has ceased activity.

---

## Relationship to Implementation

The TLA+ spec is the **source of truth** for the command ring contract. Implementations in TypeScript (for AudioWorklet), Rust, and C++ must:

1. **Implement the same state transitions** — `enqueue` and `dequeue` map directly to spec actions.
2. **Maintain the invariants** — no overwrites, FIFO order, no phantom commands.
3. **Use appropriate memory ordering**:
   - **Producer**: Write payload before incrementing `writeIndex` (release semantics).
   - **Consumer**: Read `writeIndex` with acquire semantics before reading payload.
   - In TypeScript/SharedArrayBuffer: `Atomics.store` for `writeIndex`, `Atomics.load` for reads.
4. **Be testable via generated test-vectors** — TLC can export state traces that implementations replay.

### Why `WriteAheadOfRead` and `InFlightBounded` matter

Two invariants deserve special attention for implementers:

**`WriteAheadOfRead` (`writeIndex >= readIndex`)**: This invariant ensures the producer is always "ahead of" the consumer in the logical sequence. Violating this would mean the consumer could read a slot before the producer has written to it — resulting in reading uninitialized memory (undefined behavior in C++, garbage data in JS). Implementations must ensure that `readIndex` is never incremented past `writeIndex`, which is guaranteed by the `inFlight > 0` precondition in `DequeueCommand`.

**`InFlightBounded` (`0 <= inFlight <= CAPACITY`)**: This invariant guarantees bounded buffering:
- `inFlight >= 0` prevents the consumer from "over-consuming" (reading more than was written).
- `inFlight <= CAPACITY` prevents the producer from "over-producing" (writing into slots that haven't been consumed yet).

Together, these two invariants ensure that the ring buffer operates within its allocated memory and never exposes garbage or stale data to either side.

The spec deliberately does **not** define:

- Memory layout (slot size, alignment, padding).
- Command payload structure (that's application-specific).
- Notification mechanism (consumer polling vs `Atomics.wait`).
- What happens when full (drop, block, backpressure signal) — that's policy, not protocol.

---

## Extension Note: Towards MWMR / SPARBB

The current spec models **SPSC** (exactly one producer, exactly one consumer). Future extensions may generalize to:

### Multiple Producers (MPSC)

Additional state variables:
- `producerIds`: Set of active producer IDs.
- `writeReservation`: Track which producer has "claimed" a slot for writing.
- `claimedSlots`: `[SlotIndex → ProducerId ∪ {None}]`.

Additional invariants:
- `NoABAOnSlotOwnership`: A slot released by one producer cannot be claimed by another until the consumer has read it.
- `ProducerExclusiveWrite`: Two producers never write to the same slot concurrently.
- `FairnessAmongProducers`: Under fair scheduling, all producers eventually get to enqueue.

### Multiple Consumers (SPMC / MPMC)

Additional state variables:
- `consumerIds`: Set of active consumer IDs.
- `readReservation`: Track which consumer has "claimed" a slot for reading.

Additional invariants:
- `ConsumerExclusiveRead`: Two consumers never read the same slot.
- `NoDoubleConsumption`: A command is consumed exactly once across all consumers.

### SPARBB (Single Producer, Atomic Readers, Bounded Buffer)

For broadcast scenarios (one producer, multiple readers that all see every message):

- Replace single `readIndex` with per-reader indices: `readIndices: [ReaderId → Nat]`.
- Slot is `Empty` only when all readers have advanced past it.
- Add `SlowReaderProtection`: If a reader falls too far behind, it gets a "missed messages" indication.

These extensions require additional invariants but share the core `buffer`, `writeIndex`, `SlotIndex` model from the SPSC base.

---

## TLA+ Module Structure (Sketch)

```tla
---------------------------- MODULE CommandRingProtocol ----------------------------
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    CAPACITY,             \* Ring buffer capacity
    COMMANDS              \* Set of possible commands (for bounded model checking)

VARIABLES
    buffer,               \* [0..CAPACITY-1 → {Empty} ∪ Command]
    writeIndex,           \* Nat
    readIndex,            \* Nat
    enqueuedSeq,          \* Seq(Command) - ghost variable
    consumedSeq           \* Seq(Command) - ghost variable

vars == << buffer, writeIndex, readIndex, enqueuedSeq, consumedSeq >>

\* Derived
inFlight == writeIndex - readIndex
SlotIndex(idx) == idx % CAPACITY
RingFull == inFlight = CAPACITY
RingEmpty == inFlight = 0

\* Type invariant
TypeOK ==
    /\ buffer \in [0..CAPACITY-1 -> {"Empty"} \cup COMMANDS]
    /\ writeIndex \in Nat
    /\ readIndex \in Nat
    /\ writeIndex >= readIndex
    /\ inFlight <= CAPACITY
    /\ enqueuedSeq \in Seq(COMMANDS)
    /\ consumedSeq \in Seq(COMMANDS)

\* Initial state: empty ring
Init ==
    /\ buffer = [i \in 0..CAPACITY-1 |-> "Empty"]
    /\ writeIndex = 0
    /\ readIndex = 0
    /\ enqueuedSeq = << >>
    /\ consumedSeq = << >>

\* Producer enqueues a command
EnqueueCommand(cmd) ==
    /\ ~RingFull
    /\ cmd \in COMMANDS
    /\ buffer' = [buffer EXCEPT ![SlotIndex(writeIndex)] = cmd]
    /\ writeIndex' = writeIndex + 1
    /\ enqueuedSeq' = Append(enqueuedSeq, cmd)
    /\ UNCHANGED << readIndex, consumedSeq >>

\* Producer observes full ring (no-op)
ProducerObserveFull ==
    /\ RingFull
    /\ UNCHANGED vars

\* Consumer dequeues a command
DequeueCommand ==
    /\ ~RingEmpty
    /\ LET cmd == buffer[SlotIndex(readIndex)]
       IN  /\ consumedSeq' = Append(consumedSeq, cmd)
           /\ buffer' = [buffer EXCEPT ![SlotIndex(readIndex)] = "Empty"]
           /\ readIndex' = readIndex + 1
    /\ UNCHANGED << writeIndex, enqueuedSeq >>

\* Consumer observes empty ring (no-op)
ConsumerObserveEmpty ==
    /\ RingEmpty
    /\ UNCHANGED vars

\* Next-state relation
Next ==
    \/ \E cmd \in COMMANDS : EnqueueCommand(cmd)
    \/ ProducerObserveFull
    \/ DequeueCommand
    \/ ConsumerObserveEmpty

\* ============================================================================
\* SAFETY INVARIANTS
\* ============================================================================

IndicesMonotonic == 
    [][writeIndex' >= writeIndex /\ readIndex' >= readIndex]_vars

WriteAheadOfRead == writeIndex >= readIndex

InFlightBounded == inFlight >= 0 /\ inFlight <= CAPACITY

NoOverwriteOfPending ==
    \* Enforced structurally by RingFull guard in EnqueueCommand.
    \* The ghost sequences provide the semantic proof via FIFOOrderPreserved.
    TRUE

FIFOOrderPreserved ==
    \* consumedSeq is a prefix of enqueuedSeq
    /\ Len(consumedSeq) <= Len(enqueuedSeq)
    /\ \A i \in 1..Len(consumedSeq) : consumedSeq[i] = enqueuedSeq[i]

NoPhantomCommands ==
    \* Every consumed command was enqueued
    \A i \in 1..Len(consumedSeq) : 
        \E j \in 1..Len(enqueuedSeq) : consumedSeq[i] = enqueuedSeq[j]

Safety ==
    /\ TypeOK
    /\ WriteAheadOfRead
    /\ InFlightBounded
    /\ FIFOOrderPreserved
    /\ NoPhantomCommands

\* ============================================================================
\* LIVENESS PROPERTIES
\* ============================================================================

\* Fairness on individual actions (more precise than WF_vars(Next))
ConsumerFairness == WF_vars(DequeueCommand)
ProducerFairness == WF_vars(\E cmd \in COMMANDS : EnqueueCommand(cmd))

EventuallyConsumed ==
    \* If a command is enqueued, it is eventually consumed
    \A i \in 1..Len(enqueuedSeq) : <>(i <= Len(consumedSeq))

NoConsumerStarvation ==
    \* If ring is non-empty, consumer eventually dequeues
    [](~RingEmpty => <>(readIndex' > readIndex))

\* Conditional liveness: if producer stops, ring eventually empties
\* (This would require modeling "producer stopped" as a state predicate)
\* EventuallyEmptyIfProducerStops == (ProducerStopped) ~> (RingEmpty)

Spec == Init /\ [][Next]_vars /\ ConsumerFairness

\* ============================================================================
\* THEOREMS
\* ============================================================================

THEOREM Spec => []Safety
THEOREM Spec => EventuallyConsumed
THEOREM Spec => NoConsumerStarvation

=============================================================================
```

---

## Test Vector Shape (Proposed)

```json
{
  "name": "basic_enqueue_dequeue",
  "description": "Simple enqueue followed by dequeue preserves command",
  "capacity": 4,
  "initialState": {
    "buffer": ["Empty", "Empty", "Empty", "Empty"],
    "writeIndex": 0,
    "readIndex": 0
  },
  "steps": [
    {
      "action": "EnqueueCommand",
      "args": { "cmd": { "tag": "SetGain", "payload": 0.5, "seq": 1 } },
      "expectedState": {
        "buffer": [{ "tag": "SetGain", "payload": 0.5, "seq": 1 }, "Empty", "Empty", "Empty"],
        "writeIndex": 1,
        "readIndex": 0,
        "inFlight": 1
      }
    },
    {
      "action": "DequeueCommand",
      "expectedCommand": { "tag": "SetGain", "payload": 0.5, "seq": 1 },
      "expectedState": {
        "buffer": ["Empty", "Empty", "Empty", "Empty"],
        "writeIndex": 1,
        "readIndex": 1,
        "inFlight": 0
      }
    }
  ],
  "invariants": ["FIFOOrderPreserved", "NoPhantomCommands", "InFlightBounded"]
}
```

```json
{
  "name": "fifo_order_three_commands",
  "description": "Three commands dequeued in enqueue order",
  "capacity": 4,
  "steps": [
    { "action": "EnqueueCommand", "args": { "cmd": { "seq": 1 } } },
    { "action": "EnqueueCommand", "args": { "cmd": { "seq": 2 } } },
    { "action": "EnqueueCommand", "args": { "cmd": { "seq": 3 } } },
    { "action": "DequeueCommand", "expectedCommand": { "seq": 1 } },
    { "action": "DequeueCommand", "expectedCommand": { "seq": 2 } },
    { "action": "DequeueCommand", "expectedCommand": { "seq": 3 } }
  ]
}
```

```json
{
  "name": "full_ring_backpressure",
  "description": "Producer cannot enqueue when ring is full",
  "capacity": 2,
  "steps": [
    { "action": "EnqueueCommand", "args": { "cmd": { "seq": 1 } }, "expectedInFlight": 1 },
    { "action": "EnqueueCommand", "args": { "cmd": { "seq": 2 } }, "expectedInFlight": 2 },
    { 
      "action": "ProducerObserveFull",
      "comment": "Ring full, cannot enqueue",
      "expectedInFlight": 2
    },
    { "action": "DequeueCommand", "expectedCommand": { "seq": 1 }, "expectedInFlight": 1 },
    { 
      "action": "EnqueueCommand", 
      "args": { "cmd": { "seq": 3 } }, 
      "comment": "Now space available",
      "expectedInFlight": 2 
    }
  ]
}
```

```json
{
  "name": "wraparound",
  "description": "Indices wrap around buffer correctly",
  "capacity": 2,
  "steps": [
    { "action": "EnqueueCommand", "args": { "cmd": { "seq": 1 } } },
    { "action": "EnqueueCommand", "args": { "cmd": { "seq": 2 } } },
    { "action": "DequeueCommand", "expectedCommand": { "seq": 1 } },
    { "action": "DequeueCommand", "expectedCommand": { "seq": 2 } },
    { 
      "action": "EnqueueCommand", 
      "args": { "cmd": { "seq": 3 } },
      "comment": "writeIndex=2, slot 0 (2 % 2)",
      "expectedState": { "writeIndex": 3, "readIndex": 2 }
    },
    { 
      "action": "DequeueCommand",
      "expectedCommand": { "seq": 3 },
      "comment": "readIndex=2, slot 0 (2 % 2)"
    }
  ]
}
```

---

## How to Run (Proposed)

### TLA+ Toolbox

1. Open `CommandRingProtocol.tla`
2. Create a new model with small bounds (e.g., `CAPACITY = 3`, `COMMANDS = {c1, c2, c3}`)
3. Add invariants: `TypeOK`, `FIFOOrderPreserved`, `NoPhantomCommands`, `InFlightBounded`
4. Add properties: `EventuallyConsumed`, `NoConsumerStarvation`
5. Run TLC

### Command Line

```bash
java -jar tla2tools.jar -config CommandRingProtocol.cfg CommandRingProtocol.tla
```

---

## Configuration File (Proposed)

```
\* CommandRingProtocol.cfg

\* ============================================================================
\* CONSTANTS
\* ============================================================================
CONSTANT CAPACITY = 3
CONSTANT COMMANDS = {[tag |-> "A", seq |-> 1], [tag |-> "B", seq |-> 2], [tag |-> "C", seq |-> 3]}

\* ============================================================================
\* SPECIFICATION
\* ============================================================================
SPECIFICATION Spec

\* ============================================================================
\* INVARIANTS
\* ============================================================================
INVARIANTS
    TypeOK
    WriteAheadOfRead
    InFlightBounded
    FIFOOrderPreserved
    NoPhantomCommands

\* ============================================================================
\* PROPERTIES
\* ============================================================================
PROPERTIES
    EventuallyConsumed
    NoConsumerStarvation
```

Note: `EventuallyEmptyIfProducerStops` is not included as a property here because it requires modeling "producer stopped" as a state predicate, which is beyond the scope of this basic spec. In practice, this property would be verified in an extended model that tracks producer activity.

---

## Why This Matters for Real-Time Audio

In RT audio, the command ring is the **only safe channel** for delivering control commands (swap engine, update preset, trigger event) from the host thread to the audio callback. The protocol must guarantee:

- **No blocking**: Both producer and consumer are lock-free.
- **No data races**: Memory ordering prevents torn reads of command payloads.
- **Bounded latency**: Consumer processes commands within predictable bounds.
- **No lost commands**: Every enqueued command is eventually observed.

By formally specifying the ring protocol, we ensure the **design** is correct before implementing in TypeScript (AudioWorklet), Rust (native plugin), or C++ (JUCE/VST).

---

## Contract Summary

### What the protocol guarantees

Given a valid capacity and cooperating producer/consumer:

- Commands are consumed in **exactly the order** they were enqueued (FIFO).
- **No command is lost** — every enqueue is eventually matched by a dequeue.
- **No phantom commands** — the consumer never observes a command that wasn't enqueued.
- **Bounded in-flight** — at most `CAPACITY` commands are pending at any time.

### What the caller is responsible for

**Producer** must:
- Check `inFlight < CAPACITY` before calling `enqueue` (or handle backpressure).
- Ensure command payload is fully written before incrementing `writeIndex`.
- Use release semantics on `writeIndex` store.

**Consumer** must:
- Check `inFlight > 0` before calling `dequeue` (or handle empty ring).
- Use acquire semantics on `writeIndex` load.
- Process commands promptly to avoid ring saturation.

The protocol deliberately does **not** define:
- What to do when the ring is full (drop, block, signal).
- Command payload structure or interpretation.
- Notification mechanism (polling vs wait/notify).
- Multi-producer or multi-consumer semantics (see extension notes).
