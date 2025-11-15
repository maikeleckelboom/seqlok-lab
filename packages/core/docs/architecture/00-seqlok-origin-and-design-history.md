# Seqlok Origin & Design History

> A short backstory: what problems Seqlok set out to solve, and which design bets shaped the architecture you see in the
> rest of these docs.

This document is **background**, not a spec.
The normative design docs start at `01-…`.
Think of this as the director's commentary track.

---

## 1. Where Seqlok came from

Seqlok grew out of a very specific pain:

- Real-time code (audio, simulation, high-frequency visuals) runs in its own thread / worklet.
- UI lives on the main thread.
- `postMessage` + JSON is:
  - Too slow,
  - Too allocation-heavy,
  - Too unpredictable for real-time hot paths.

We wanted:

- **Shared state** between UI and RT threads,
- **Zero allocation** in the hot path,
- **No locks**, but coherent snapshots,
- **Type safety** end-to-end.

The obvious building blocks were:

- `SharedArrayBuffer` + typed arrays,
- `Atomics`,
- A small concurrency discipline that we could actually reason about.

Everything else in Seqlok is layered on top of that starting point.

---

### 1.1 The real origin: the AudioWorklet quantum

The immediate trigger for Seqlok was the Web Audio / AudioWorklet processing model:

- The audio engine calls `AudioWorkletProcessor.process()` in fixed-size quanta
  (e.g. 128 frames ≈ 2.67ms at 48 kHz).
- Each call is responsible for a precise frame range:
  - Quantum N: `currentFrame` … `currentFrame + 127`
  - Quantum N+1: `currentFrame + 128` … `currentFrame + 255`
  - Quantum N+2: `currentFrame + 256` … `currentFrame + 383`, etc.
- In each quantum, the processor needs to:
  1. Apply any parameter changes that are scheduled for this block,
  2. Possibly schedule new changes for future blocks,
  3. Fill the output buffer before the deadline.

Meanwhile, the main thread (UI) generates events at arbitrary times:
mouse movements, automation curves, MIDI, transport changes…

The hard problem is to bridge "chaotic UI time" to "deterministic audio quanta"
without allocations, without locks, and without ever observing torn state
mid-quantum.

Seqlok's design – two SWMR domains, a planned memory plan, seqlock-based
snapshots, and a type-first spec DSL – is a direct answer to that constraint.

---

## 2. Early architectural bets that never changed

From the beginning, a few decisions crystallised and have stayed fixed:

### 2.1 Two SWMR domains

We drew a hard line between two domains:

- **Params domain** _(UI → RT)_

  - Single writer: controller
  - Multiple readers: processors

- **Meters domain** _(RT → UI)_
  - Single writer: processor
  - Multiple readers: controllers

No other cross-thread writes are allowed.
That "two domains, SWMR each" rule is the backbone of the concurrency model in `03-…`.

### 2.2 Spec → Plan → Backing → Handoff → Bindings

We standardised on a pipeline that still exists today:

```text
spec (DSL)
  → planLayout (plan)
  → backing (shared memory)
  → handoff (metadata for other threads)
  → bindings (controller / processor views)
```

- **Spec**: the semantic contract (names, types, ranges).
- **Plan**: the deterministic memory plan.
- **Backing**: the actual shared memory implementing that plan.
- **Handoff**: a small, serialisable description of “this plan + this memory”.
- **Bindings**: safe, typed accessors for each role.

The names and ergonomics have improved over time, but that pipeline is the same idea we started with, just more
polished.

### 2.3 Seqlocks over raw locks

We chose **seqlocks** (sequence locks) very early:

- Writers:

  - Bump a lock counter on enter/exit,
  - Bump a sequence counter on commit.

- Readers:

  - Spin briefly if a write is in progress,
  - Retry if they detect a change while reading,
  - Otherwise get a coherent snapshot.

That's what lets us have:

- Lock-free reads,
- Bounded retry behaviour,
- No partially seen writes.

The seqlock protocol and plane plan are now fully documented in `08-…` and `09-…`.

### 2.4 Type-first DSL

We always wanted the DSL to be:

- The **single source of truth** for state shape,
- Strong enough that TypeScript can infer:

  - Param keys and value types,
  - Meter keys and value types,
  - Binding shapes for controller and processor.

That's what `defineSpec` and the various `ParamKeys<S>`, `MeterKeys<S>`, `ParamValueFor<S,K>`, etc. are doing today.

---

## 3. Principles that emerged as we iterated

As Seqlok matured, a few principles solidified and shaped the current architecture.

### 3.1 Functional core, OO at the edges

The core is intentionally **not** object-oriented:

- It's built from data types and pure-ish functions:

  - `planLayout`, `allocateShared`, `buildHandoff`, `bindController`, `bindProcessor`, …

- Each function lives in a clear layer:

  - `spec`, `plan`, `backing`, `handoff`, `binding`.

Higher-level code is free to introduce:

- Context objects,
- Factories/builders,
- Framework-specific helpers (React/Vue, AudioWorklet wrappers, etc.).

But the kernel stays small, explicit, and easy to reason about.
That's the story in `06-object-model-rationale.md`.

### 3.2 Fail-fast, explicit errors

We chose a **fail-fast** error model:

- If a spec and backing don't match, we throw.
- If a handoff doesn't match the local plan, we throw.
- If a domain is misused (wrong writer, invalid key), we throw.

Errors are tagged by domain (`spec.*`, `plan.*`, `backing.*`, `handoff.*`, `binding.*`, `orchestration.*`) so that
failures can be understood and surfaced cleanly.
The rationale is spelled out in `05-seqlok-error-system-and-fail-fast-philosophy.md`.

### 3.3 Layering is non-negotiable

We enforced a strict module dependency order:

```text
primitives → spec → plan → backing → handoff → binding → (orchestration/helpers)
```

This is enforced in tooling (linting/TS config) as well as in docs.
The goal: no “god objects”, no cycles, clear ownership of responsibilities.

---

## 4. How to read the rest of the docs

If you want to understand Seqlok's design in order:

1. `01-seqlok-goals-and-non-goals.md`
   Why this library exists, and what it explicitly refuses to do.

2. `02-seqlok-intellectual-heritage.md`
   The ideas it builds on (seqlocks, SWMR, shared memory patterns, etc.).

3. `03-seqlok-concurrency-model-and-roles.md`
   Controller vs processor, params vs meters, seqlock behaviour.

4. `04-seqlok-dsl-overview-and-rationale.md`
   The spec DSL and type-inference story.

5. `05-seqlok-error-system-and-fail-fast-philosophy.md`
   How and why failures are surfaced.

6. `06-object-model-rationale.md`
   Why the core is function-centric and not OO.

7. `07-seqlok-api-shape-rationale.md`
   Why the core functions take the arguments they do (spec / plan / backing / handoff).

8. `08–09`
   The low-level primitives and backing plan.

9. `11-seqlok-e2e-flow-visual-guide.md`
   A picture of it all working together, end-to-end.

This `00` document is just the small bit of story glue before all that: the snapshot of what we were trying to achieve
when we started, and which design bets proved stable enough to keep.
