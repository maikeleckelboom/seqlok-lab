# TLA+ Specification Roadmap for Seqlok & Dekzer

**Status:** Planning  
**Last Updated:** December 2024

---

## Overview

This document outlines the formal verification strategy for Seqlok and Dekzer using TLA+. Each specification is designed
to be small enough to model without excessive complexity, while together they provide comprehensive coverage of critical
control paths from UI → shared memory → engines → logs.

The goal: *"Every critical control path is either tested, specified, or both."*

---

## Priority Order

1. **Param/meter binding** + **Command bus semantics** (Seqlok-level, high reuse)
   — Implemented as `ParamBinding` and `CommandMailbox` TLA+ modules described in `tla-seqlok-substrate-specs.md`
2. **Multi-engine hotswap driver** + **Deck time / quantized scheduling** (Dekzer audio core)
3. **Mode / authority spec** (Takeover/Edit/Passive)
4. **SessionRecorder determinism**
5. Later: Collaboration + Ghost DJ integration + GPU pipeline

---

## 1. Seqlok Substrate: Specs Close to the Metal

These are "small but sharp" specs — few variables, lots of mileage.

### 1.1 Param / Meter Binding Protocol

**What to Model**

- One writer thread (`controller`) calling:
  - `params.set`, `params.update`, `params.stage`
- One reader thread (`processor`) calling:
  - `params.within(cb)`, `meters.publish(cb)`
- The underlying shared arrays + sequence numbers

**Key Invariants**

- Reads in `within` are **coherent**: every scalar/array read inside a window sees the same version
- No *torn* numbers or half-written arrays
- Each `stage` produces at most **one** logical update (1× LU bump)
- Range policy: `clamp` vs `reject` behaves as advertised for scalars; arrays only enforce shape
- **Array Shape Invariant (later extension)**: for array params, the spec only enforces shape/length; there is
  deliberately **no per-element clamping**. Range policy applies only to scalars.

**Why It's Worth It**

This is the core promise of Seqlok. If this spec says "no coherent snapshot exists under these interleavings" you've
caught a bug that would manifest as rare, horrible deck glitches.

---

### 1.2 CommandMailbox Semantics (Beyond the Raw SWSR Ring)

Extends the existing SWSR ring semantics one level up.

**What to Model**

- `CommandCodec`-style mailbox:
  - Producer pushing commands
  - Consumer draining with hooks (`onCommand`, `onUnknown`, `onInvalid`)
- Open/closed state, drops vs backpressure rules
- Optional "priority" or "time-bucket" queues if added later

**Key Invariants**

- No command is **processed twice**
- No command is processed **after** a `close` that should cancel it (Reset semantics modelled in a separate,
  higher-level spec)
- Depth/indices always match the logical queue contents
- For "must-not-drop" commands: if enqueued successfully, they are either processed or cancelled by an explicit event

**Liveness**

- If producer stays within capacity and consumer keeps draining, commands are eventually processed

This formalizes the control plane that everything else is built on.

---

### 1.3 Multi-Engine Hotswap Driver (Beyond the Raw Protocol)

Extends the basic hotswap state machine to **driver + engines**.

**What to Model**

- A lane with:
  - `currentEngine`, `nextEngine`, maybe a `retiringEngine`
  - States: `Idle`, `Spawned`, `Primed`, `PreWarmed`, `CrossFading`, `Retiring`
- Commands: `RequestSwap`, `AbortSwap`, `QualityStepUp`, `QualityStepDown`

**Key Invariants**

- At most **one active engine** contributes to the output at a given time index
- No engine is **reused** after retirement
- No "stuck half swap": any started swap either completes (`next` becomes `current`) or cleanly aborts
- Crossfade window never overlaps two separate swaps
- The lifecycle of any `EngineId` is a linear chain: `Spawned → Primed → PreWarmed → CrossFading (as next) → Retired`
  with no backwards edges and no reuse after `Retired`

**Liveness**

- If the environment keeps providing audio and doesn't spam contradictory commands, a requested swap eventually
  completes

This de-risks the entire "spawn + prime + preWarm + crossFade + retire" choreography at the level Dekzer actually uses.

---

## 2. Dekzer Driver / Deck-Level Behaviour

DJ-specific specifications.

### 2.1 Global Authority + Interaction Modes

Models the Takeover / Edit / Passive mode system.

**What to Model**

- A set of decks `D`, a global mode `Mode ∈ {Takeover, Edit, Passive}`
- Command types: transport, mix, edit, annotate, etc.
- A small timeline of "canonical set state" (what the listener hears)

**Key Invariants**

- In **Passive** mode, no command can change canonical audio state (only observe / annotate)
- In **Edit** mode, commands can mutate **draft state**, but commits happen at safe boundaries (e.g. "after bar N") and
  are atomic
- In **Takeover** mode, only the active performer can issue transport-affecting commands; companions can't preempt them

**Liveness**

- Any "scheduled commit" in Edit mode eventually either applies or is cancelled; it can't hang forever in limbo

This spec proves "mode-switching can't trash the set".

---

### 2.2 Deck Time + Quantized Scheduling

The "no off-by-one bar" spec.

**What to Model**

- A single deck with:
  - `playhead` in beats/frames
  - `tempo`, `quantum` (e.g. 1 bar)
  - A queue of scheduled commands: `Play`, `Stop`, `TriggerCue`, `SwapEngine`, each with `applyAt`
- A simple block-based clock advancing the deck state

**Key Invariants**

- If `applyAt` is expressed in quantized units (e.g. bar indices), the command fires in the correct bar, not early/late
- Playhead never jumps in a way that would skip scheduled swaps or cues
- No "double fire" of a scheduled action across tempo changes

**Liveness**

- If we schedule a command at a future bar and keep the deck running, eventually that bar is reached and the command is
  applied exactly once

This proves the "sample-accurate applyAtFrame / beat" story.

---

## 3. Session Log + Collaboration

### 3.1 SessionRecorder: "Everything That Changed What We Heard"

**What to Model**

- A stream of events:
  - Commands that affect output
  - Metadata (annotations, markers)
  - Optional non-audio events
- A simple "player" that replays the log to reconstruct state

**Key Invariants**

- **Determinism**: replaying the log from a known initial state yields a unique set state
- Log truncation rules (e.g. discarding old annotations) never destroy events needed to reconstruct audible output
- Log ordering: if event `e2` depends on `e1`, then `e1` precedes `e2` in the log

**Liveness**

- For a running performance, every command that changes output eventually enters the log

Foundation for: "replay the set", "AI planning using logs", "generate a highlight reel".

---

### 3.2 Multi-Client Collaboration (Future)

For "Dekzer as multiplayer".

**What to Model**

- Two clients, one host
- Each client produces high-level edits (`AddCue`, `MoveLoop`, `ChangeEnginePreset`)
- A merge function that decides when concurrent edits conflict

**Key Invariants**

- **No silent loss** of commits: any locally confirmed edit either:
  - is present in the merged timeline, or
  - is explicitly marked as "rejected/overwritten"
- "Host wins" or other policy is applied consistently and visibly
- The merged command timeline is totally ordered

**Liveness**

- As long as network eventually delivers messages, all accepted edits eventually appear in everyone's view

Prevents "ghost edits" and race-y collaboration behaviour.

---

## 4. Ghost DJ / AI Planning Integration

### 4.1 "Reflex vs Reflection" Command Boundary

Models the contract between the **real-time brain** and the **planning brain**.

**What to Model**

- A RT system with a queue of "micro-commands" (engine swaps, minor EQ changes)
- A planner that proposes **macro-actions** (`BuildTransition(A→B)`, `DownshiftEnergy`, etc.)
- A gateway that expands macros into sequences of RT commands, subject to constraints

**Key Invariants**

- Planner output can *suggest*, but cannot:
  - Violate timing safety margins (`crossFade` windows, prewarm budgets)
  - Push commands that aren't allowed in current mode (e.g. no hard stop in Passive)
- The RT loop can always **veto** or defer planner actions if they'd cause overload

**Liveness**

- Any macro that's accepted and scheduled eventually either:
  - Completes (all underlying RT commands applied), or
  - Is cancelled cleanly; it never half-applies

Keeps "Ghost DJ" from turning into "Unhinged DJ".

---

## 5. GPU / Waveform Pipeline (Stretch Goal)

### 5.1 Multi-LOD Waveform Texture Updates

**What to Model**

- A CPU thread that:
  - Streams decoded audio samples
  - Fills multiple LOD buffers (`LOD1`, `LOD2`, …)
  - Publishes "frame ready" flags
- A render loop that:
  - Reads consistent snapshots of those LODs
  - Obeys some staleness bound

**Key Invariants**

- Renderer never sees a **partially updated** LOD (no half-written stripe)
- LOD hierarchy coherent: higher LODs are never "newer" than lower ones in an impossible way
- No overwrite of buffers still in use by GPU (if modelling double-buffering / fences)

Matches the same story: "You can trust what you see on screen to represent coherent, non-torn state."

---

## Notes

- Each spec is designed to be tractable — few state variables, focused invariants
- Together they cover: Seqlok primitives → Dekzer audio core → Session management → AI integration → Rendering
- The command ring + hotswap corner is already partially covered by existing specs; these extend coverage to the rest of
  the system
