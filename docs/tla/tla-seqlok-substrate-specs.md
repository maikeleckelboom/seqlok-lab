# TLA+ Seqlok Substrate Specifications

**Status:** Ready for Implementation  
**Layer:** Foundational (everything else depends on these)  
**Last Updated:** December 2024

---

## Why These Two First

These specs sit **underneath** all the fun stuff: engine swaps, GPU waves, Ghost DJ, collaboration. They're small enough
to actually model check with TLC without crying, and they're generic — once you trust the param/meter bindings and the
mailbox semantics, every engine and deck flow you build on top can lean on them as axioms.

If these are wrong, everything else is vibes and lies.

---

## 1. Param / Meter Binding Spec

### 1.1 Scope for v1

Keep it brutally tiny:

- 1 scalar param `p` (later extend to many / arrays)
- 1 scalar meter `m`
- Two abstract actors:
  - `Controller` calling `Set` and `Stage` (`Update` is sugar, added in a later refinement)
  - `Processor` calling `Within` and `Publish`

**API Mapping**

Controller surface corresponds directly to the JS API:

- `ControllerSet` ≡ `params.set`
- `ControllerStage` ≡ `params.stage`
- `ControllerUpdate` (later) ≡ `params.update`

Processor surface:

- `ProcessorWithin` ≡ `params.within`
- `ProcessorPublish` ≡ `meters.publish`

Under the hood, model:

- A shared param store: `ParamVal` (the "current" value)
- A logical **version** or LU counter: `ParamVer`
- A shared meter store: `MeterVal`
- Maybe a `Mode ∈ {"clamp","reject"}` constant so you can branch behaviour

You don't need to model the actual `SharedArrayBuffer` or seqlock bit layout; you model the **contract** those bits are
meant to implement.

### 1.2 Behaviour to Capture

**ControllerSet(v)**

- Applies range policy
- If `Mode = "clamp"`: `ParamVal' = Clamp(v)` and `ParamVer' = ParamVer + 1`
- If `Mode = "reject"` and `v` is out of range: no change (`ParamVal' = ParamVal`, `ParamVer' = ParamVer`)

**ControllerStage(f)**

- Think of `f` as an abstract function you don't model; just say:
  - `ParamVal'` is some value in `AllowedRange`
  - `ParamVer' = ParamVer + 1`

**ProcessorWithin**

- Takes a **snapshot** for the whole duration of the callback:
  - On enter: choose `seenVer ∈ {ParamVer, ParamVerHistory}` (restrict this below)
  - Within the body, all reads see the same `(value, version)` pair
- In the spec, fuse the whole callback into one atomic action: "Processor reads `ParamVal` with version `v`"

**ProcessorPublish**

- Within a coherent read window, writes `MeterVal'` as some function of the snapshot and bumps a meter-version or
  sequence if you want it

The system behaves as if the controller did atomic versioned writes and the processor did atomic snapshot reads — no
matter how obscene the real interleavings.

### 1.3 Core Invariants

**1. Coherent Snapshot**

Inside a `Within` window, there is a single version `v` such that every param read returns the value associated with
`v`.

In TLA+ terms (because we model the callback as atomic):

- `ProcessorLastRead = [val |-> ParamVal, ver |-> ParamVer]`
- There is no intermediate state where `ProcessorLastRead.ver ≠ ParamVerAtReadTime`

Encode as a history variable.

**2. Version Monotonicity**

- `ParamVer' >= ParamVer`
- `ParamVer' = ParamVer + 1` iff a **successful** update happened (`Set` with in-range value / `Stage` / `Update` that
  actually changes something)

**3. Range Policy Correctness**

For constants `Min`, `Max`:

- If `Mode = "clamp"`: `Min ≤ ParamVal ≤ Max` is an invariant
- If `Mode = "reject"`: for all `Set` calls with `v < Min` or `v > Max`, `ParamVal' = ParamVal`

**4. Meter Coherence with Snapshot**

Whenever `Publish` updates `MeterVal`, the meter value can be expressed as a (possibly nondeterministic) function of *
*one** param snapshot. No Frankenstein mix of old/new param pieces.

Model as: `∃ snapshot ∈ ParamHistory : MeterVal' = f(snapshot)`

Add a history variable `LastSnapshotVer` that records the `ParamVer` used by the last `ProcessorWithin`. Then state:

- Whenever `Publish` changes `MeterVal`, there exists some `v` such that `v = LastSnapshotVer` and
  `MeterVal' = f(v, ParamValAt(v))`

**5. No "Extra" Bumps**

Track `LuCount` and assert:

- Each successful `Set`/`Stage` increments `LuCount`
- No other actions touch it

### 1.4 Module Shape

```tla
----------------------------- MODULE ParamBinding -----------------------------
EXTENDS Naturals, TLC

\* v1 sketch: only Set + a dummy ProcessorWithin.
\* Stage / Publish / arrays are added in a follow-up module.

CONSTANTS Min, Max, RangePolicy \* "clamp" or "reject"

VARIABLES ParamVal, ParamVer, MeterVal, LuCount

TypeOK ==
  /\ ParamVal \in Int
  /\ ParamVer \in Nat
  /\ MeterVal \in Int
  /\ LuCount  \in Nat

Init ==
  /\ ParamVal = 0
  /\ ParamVer = 0
  /\ MeterVal = 0
  /\ LuCount  = 0

ControllerSet(v) ==
  /\ v \in Int
  /\ IF RangePolicy = "clamp" THEN
        /\ ParamVal' = IF v < Min THEN Min ELSE IF v > Max THEN Max ELSE v
        /\ ParamVer' = ParamVer + 1
        /\ LuCount'  = LuCount + 1
     ELSE
        /\ IF v < Min \/ v > Max THEN
              /\ ParamVal' = ParamVal
              /\ ParamVer' = ParamVer
              /\ LuCount'  = LuCount
           ELSE
              /\ ParamVal' = v
              /\ ParamVer' = ParamVer + 1
              /\ LuCount'  = LuCount + 1
  /\ UNCHANGED MeterVal

ProcessorWithin ==
  /\ MeterVal' = MeterVal
  /\ ParamVal' = ParamVal
  /\ ParamVer' = ParamVer
  /\ LuCount'  = LuCount
  \* plus bookkeeping for "snapshot seen" if you want

Next ==
  \/ \E v \in Int : ControllerSet(v)
  \/ ProcessorWithin

Spec ==
  Init /\ [][Next]_<<ParamVal, ParamVer, MeterVal, LuCount>>

InvRange ==
  RangePolicy = "clamp" => (Min <= ParamVal /\ ParamVal <= Max)

InvVersionMonotone ==
  ParamVer >= 0 /\ LuCount >= 0

==============================================================================
```

**Extension Path:** Iteratively enrich with `Stage`, `Publish`, arrays, and snapshot history.

---

## 2. Command Bus / Mailbox Spec

Factor **SWSR ring** vs **mailbox semantics**:

- Ring spec: `writeIndex`, `readIndex`, `dropped`, capacity, header fields
- Mailbox spec: "push returns `{ok, dropped, closed}`, drain processes a prefix of the queue"

### 2.1 Abstract It Ruthlessly

Skip the physical indices first. Model:

- `Queue` as a sequence of commands: `Queue ∈ Seq(Cmd)`
- `Dropped ∈ Nat`
- `Closed ∈ BOOLEAN`

**Push(c)**

- If `Closed` ⇒ result is `mailboxClosed`, no change to `Queue`, `Dropped' = Dropped`
- Else if `Len(Queue) = Capacity-1` ⇒ drop, `Dropped' = Dropped + 1`
- Else ⇒ `Queue' = Append(Queue, c)`

**Drain**

- Nondeterministically choose `k ∈ 0..Len(Queue)`
- Emit hooks for the first `k` commands
- Remove them: `Queue' = Tail^k(Queue)`

Later refine to concrete `readIndex`/`writeIndex` and show the refinement mapping.

### 2.2 Invariants

**1. No Duplication**

- The multiset of commands ever processed (`ProcessedHistory`) is disjoint from the current `Queue`
- Any given command value appears at most once in `ProcessedHistory` if you tag them with seq IDs

**2. Drop Semantics**

- `Dropped` equals the number of `Push` attempts that rejected due to full queue (under the abstract model)
- If `Push(c)` returns `ok` in the implementation, that `c` must appear either in the queue or `ProcessedHistory` later,
  never silently lost

**3. Closed Semantics**

- Once `Closed = TRUE`, never becomes `FALSE`
- After closed, `Push` never changes `Queue` or `Dropped` (aside from "closed" accounting if you want)
- No command is processed after a `close` that should cancel it (Reset semantics are modelled in a separate,
  higher-level spec when we introduce mailbox reset into the API)

Note: In the module sketch, after `Closed` becomes `TRUE` we do not model further `Push` attempts; they're considered
out of scope for v1.

**4. Depth Consistency**

If you expose `Depth` to JS: `Depth = Len(Queue)` as an invariant.

**5. Ring Header Refinement**

When you layer ring indices back in:

- `Queue` is exactly the slice between `readIndex` and `writeIndex` modulo `capacity`
- `inFlight` computed from indices matches `Len(Queue)`

### 2.3 Module Shape

```tla
----------------------------- MODULE CommandMailbox ---------------------------
EXTENDS Naturals, Sequences, TLC

CONSTANTS Capacity, Cmd

VARIABLES Queue, Dropped, Closed, Processed

TypeOK ==
  /\ Queue \in Seq(Cmd)
  /\ Dropped \in Nat
  /\ Closed \in BOOLEAN
  /\ Processed \in Seq(Cmd)
  /\ Len(Queue) < Capacity

Init ==
  /\ Queue = << >>
  /\ Dropped = 0
  /\ Closed = FALSE
  /\ Processed = << >>

Push(c) ==
  /\ c \in Cmd
  /\ ~Closed
  /\ IF Len(Queue) = Capacity - 1 THEN
        /\ Queue' = Queue
        /\ Dropped' = Dropped + 1
        /\ Processed' = Processed
     ELSE
        /\ Queue' = Append(Queue, c)
        /\ Dropped' = Dropped
        /\ Processed' = Processed
  /\ Closed' = Closed

Close ==
  /\ ~Closed
  /\ Closed' = TRUE
  /\ UNCHANGED <<Queue, Dropped, Processed>>

Drain ==
  /\ ~Closed \/ Closed  \* you can allow draining after close
  /\ \E k \in 0..Len(Queue) :
        LET toProcess == SubSeq(Queue, 1, k)
            rest      == SubSeq(Queue, k+1, Len(Queue))
        IN
          /\ Queue' = rest
          /\ Processed' = Processed \o toProcess
          /\ Dropped' = Dropped
          /\ Closed' = Closed

Next ==
  \/ \E c \in Cmd : Push(c)
  \/ Close
  \/ Drain

Spec ==
  Init /\ [][Next]_<<Queue, Dropped, Closed, Processed>>

NoDupProcessed ==
  \A i, j \in 1..Len(Processed) :
    i # j => Processed[i] # Processed[j]

==============================================================================
```

Assert that your concrete JS ring implementation refines this high-level `Queue`/`Dropped` behaviour (possibly as a
separate refinement mapping module).

---

## 3. Refinement Strategy

Once the abstract specs pass TLC:

1. **Param Binding Refinement**

- Add `SharedArrayBuffer` layout details
- Model sequence number read/write ordering
- Show implementation refines abstract `ParamVal`/`ParamVer` contract

2. **Command Mailbox Refinement**

- Introduce `readIndex`, `writeIndex`, `capacity`
- Model header fields (`frameTime`, `processed`, etc.)
- Show ring operations refine abstract `Queue`/`Dropped` behaviour

3. **Composition**

- Compose param binding + command mailbox specs
- Verify no emergent issues when both operate concurrently

---

## 4. Extension Checklist

After v1 passes:

**Param Binding Extensions**

- [ ] Multiple params (extend to `ParamStore: ParamId -> ParamVal`)
- [ ] Array params (model shape enforcement)
- [ ] `Update` sugar (define as a derived action over Set/Stage)
- [ ] Snapshot history variable for meter coherence proof

**Command Mailbox Extensions**

- [ ] Priority queues / time-bucket queues
- [ ] "Must-not-drop" command class
- [ ] `onUnknown` / `onInvalid` hook semantics
- [ ] Backpressure vs drop policy toggle

---

## Notes

- These give "deep confidence per LOC of math"
- Once nailed, the rest of Dekzer's TLA story becomes downstream constraint instead of foundational panic
- Target: TLC model checking with small state spaces first, then scale up constants
