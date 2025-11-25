# Seqlok v1.0 – Gravity Well

**Purpose**: Keep every decision aligned with shipping a **stable, minimal, production-ready real-time control fabric**.

**Last Updated**: 2025-11-24
**Target**: v1.0 Production Launch
**Status**: 🟡 Baseline only – use `STATUS-MATRIX.md` as the single source of truth

---

## 🎯 The North Star

Seqlok v1.0 is **DONE** when:

1. **You can write a DJ deck engine in ~200 lines** on top of Seqlok that never drops audio.
2. **You can hot-swap that engine mid-phrase** with zero audible artifacts, under load.
3. **You can port the host to Rust/C++** without rewriting Seqlok semantics.
4. **You can ship an engine pack** (foreign DSP) with structured, machine-consumable error handling.
5. **You trust it in front of 5,000 people** on an unreliable laptop + browser.

Everything else is either support work or distraction.

---

## 📊 Current State (High-Level)

**This section is descriptive, not a progress bar. Actual status lives in `completion/STATUS-MATRIX.md`.**

As of 2025-11-24:

- `@seqlok/core` v0.2.x exists and implements the **golden flow** in a single package
    -
    `defineSpec → planLayout → allocateShared → buildHandoff → receiveHandoff → bindController/bindProcessor/bindObserver`
- The **monorepo split** into `@seqlok/foundation`, `@seqlok/primitives`, `@seqlok/diagnostics`, `@seqlok/commands`,
  `@seqlok/hotswap`, `@seqlok/integration` is **designed but not yet fully implemented**.
- The **error system** is still effectively centralized in `@seqlok/core`; the distributed-domain plan exists as a spec
  and is being implemented.
- `@seqlok/commands` and `@seqlok/hotswap` are **conceptual** with no production implementation yet.
- Cross-language (Rust/C++) prototypes and JSON error schema are **not built yet**.
- Docs exist for the current core, but **monorepo and v1.0 story are ahead of the docs**.

Treat this file as the **intent** and `STATUS-MATRIX.md` as the **current reality**.

---

## 🚀 Critical Path to v1.0

This is the **minimum viable sequence** to reach "I can use this in production".
Durations are intentionally omitted; ship-time depends on focus.

### Phase 1 – Land the Architecture Base (v0.3.x)

Goal: **Split the monolith and stabilize the contracts** without changing behaviour.

1. **Create and wire base packages**
    - Materialize:
        - `@seqlok/foundation` – error primitives, invariants, health helpers.
        - `@seqlok/primitives` – seqlock + low-level concurrency/memory primitives.
        - `@seqlok/diagnostics` – env probing + diagnostics/health helpers.
    - Move code out of `@seqlok/core` into the owning packages.

2. **Implement distributed error domains**
    - Move error codes into:
        - `internal.*` → foundation
        - `primitives.*` → primitives
        - `diagnostics.*, env.*` → diagnostics
        - `spec.*, plan.*, backing.*, binding.*, handoff.*` → core
    - Keep `@seqlok/core` as **global registry aggregator** with identical runtime behaviour.

3. **Stabilize build + tests for the split**
    - `pnpm test`, `pnpm tsc -b` and benchmarks pass with the new package layout.
    - No new circular dependencies; dependency rules enforced (foundation at bottom, integration at top).

4. **Write a minimal, language-agnostic layout spec**
    - Document plane types, alignment, and layout rules so a Rust/C++ implementation can be written without reading the
      TS code.

**Exit criteria**:
Core still behaves as before, but the **packages and error ownership now match the architecture**.

---

### Phase 2 – Commands & Hotswap (v0.4.x cluster)

Goal: **Add the time dimension and lifecycle** without compromising correctness.

1. **Implement `@seqlok/commands`**
    - SWSR command ring primitive (or equivalent).
    - Producer / consumer API with clear ownership and budgeting semantics.
    - Command shapes for the "deck engine" use case (start/stop, param changes, swap requests).

2. **Implement `@seqlok/hotswap`**
    - Engine slot abstraction and lifecycle state machine.
    - Swap protocol: spawn → prime → pre-warm → crossFade → retire.
    - Ticket semantics: each swap has a clear terminal state (success, aborted, failed).

3. **Add invariants + tests**
    - Property tests for:
        - Command ring: no loss, no duplication, order guarantees.
        - Hotswap: at most one active engine per slot, eventual terminal state per ticket.
    - Stress tests with randomized sequences (SPARBB-style harness).

**Exit criteria**:
You can drive a trivial engine via commands + hotswap with **no races and no surprises**, under automated tests.

---

### Phase 3 – Reference Integrations

Goal: **Prove the system in anger** with real hosts.

1. **Reference Integration #1 – Minimal audio deck**
    - One deck with:
        - Controller (UI or script) using `bindController`.
        - Processor worker using `bindProcessor`.
        - Observer for meters/Waveform.
    - Uses commands + hotswap to swap between at least two engines (e.g., varispeed and stretch).

2. **Reference Integration #2 – Non-audio simulation**
    - WebGPU or JS-based sim (e.g., boids/swarm).
    - Simulation worker acts like an "engine" using params/meters.
    - Optional: hotswap between "kernels" or behaviours.

3. **Document both**
    - Short guides explaining:
        - Topology (threads/workers).
        - How params/meters/commands/hotswap compose.
        - Error handling flows.

**Exit criteria**:
Two working examples that **compile, run, and make the architecture tangible**.

---

### Phase 4 – Cross-Language & Production Hardening

Goal: **Lock the semantics beyond TypeScript and beyond your laptop.**

1. **Error schema + x-lang prototypes**
    - Generate JSON (or similar) schema from the error registry.
    - Minimal Rust and/or C++ prototype:
        - Reads params, writes meters via the layout spec.
        - Consumes the error schema and maps codes to enums.

2. **Perf & CI hardening**
    - Perf smoke tests in CI with clear budgets for hot paths.
    - CI covers:
        - Node.
        - Browser-equivalent.
        - Key env feature combinations (SAB/Atomics/WASM presence).

3. **Docs & governance**
    - VitePress docs build in CI.
    - Per-package changelogs.
    - Documented deprecation and error-code evolution policy.

**Exit criteria**:
Seqlok can be **implemented in another language**, and CI is good enough that **if it's green, you'll play it in a club
**.

---

## 📁 Document Suite

- **Completion Tracking**
    - `completion/STATUS-MATRIX.md` – detailed DoD completion grid (single source of truth).
    - `planning/PACKAGE-READINESS.md` – per-package readiness and checklists.

- **Planning & Execution**
    - `planning/CRITICAL-PATH.md` – more detailed breakdown of the phases above.
    - `reference/WEEKLY-SPRINT.md` – sprint planning template.

- **Reference & Templates**
    - `reference/DECISION-TEMPLATE.md` – ADR template.
    - `../architecture/00-definition-of-done.md` – full DoD specification (this gravity well is the summary).

---

## 🧭 Decision Framework

When you're unsure what to do next, run the work through this filter.

### 1. Does this directly unblock v1.0?

- **Yes** → It belongs in one of the phases above → Prioritize.
- **No** → Put it in the backlog for v1.1+.

### 2. Does this maintain or improve correctness?

- **Yes** → Good candidate; keep the surface small.
- **No** → Reject or redesign.

### 3. Does this expand the public API surface?

- **Yes** → Needs a strong architectural rationale. Prefer putting it in a new package over expanding `@seqlok/core`.
- **No** → It’s either internal or refinement; lower blast radius.

### 4. Does this make cross-language interop harder?

- **Yes** → Either redesign or document a very explicit escape hatch.
- **No** → Good; keep the semantics portable.

### 5. Is this "nice to have" or "must have"?

- **Nice** → Capture in an ADR/backlog item, revisit after v1.0.
- **Must** → It should already be in the DoD or critical path; if not, update those first.

---

## ⚠️ Anti-Patterns to Avoid

| Anti-Pattern                      | Why It Hurts                               | Do This Instead                                         |
|-----------------------------------|--------------------------------------------|---------------------------------------------------------|
| “Let’s add sugar for X”           | Surface area explosion, harder v1.0 freeze | Keep core minimal; sugar can be post-v1 add-on packages |
| “I’ll refactor this later”        | Rot accumulates exactly on hot paths       | Either fix now or leave a very explicit TODO + ADR      |
| “Just one more feature…”          | Scope creep eats time for invariants       | Ask: does it unblock v1.0? If not, backlog it           |
| “Tests are flaky but I know why”  | You stop trusting CI                       | Fix flakes immediately; tests are part of the contract  |
| “I’ll document it when it’s done” | The mental model diverges from reality     | Rough docs first, refine as you go                      |
| “Let’s make it perfect first”     | Infinite delay, no club-tested feedback    | Ship minimal, correct, observable; then iterate         |

---

## 📈 Progress Signal (Interpretation, Not Truth)

These are **interpretation rules** for `STATUS-MATRIX.md`:

- **Green-light to ship**:
    - All DOD sections "mostly green".
    - Commands + hotswap implemented, tested, and used in at least one reference integration.
    - Error schema + layout spec exist and are used in at least one x-lang prototype.
    - CI includes tests, perf smoke, and docs build.

- **Yellow-light**:
    - One or two DOD sections "lagging" but non-blocking (e.g. docs polish).
    - Reference integrations exist but are a bit rough.
    - Some governance pieces (changelogs, deprecation docs) still missing.

- **Red-light**:
    - Commands/hotswap not implemented or not tested.
    - No reference integration exercises the full flow.
    - Concurrency invariants not covered by tests.
    - CI is green but doesn't actually run the important checks.

---

## 🎬 Quick Usage

### First time you open this repo on a new day

1. Skim `completion/STATUS-MATRIX.md` – what’s currently red/yellow?
2. Look at `planning/CRITICAL-PATH.md` – where are you in the phases?
3. Pick the smallest next task that moves a red/yellow cell toward green.

### When making a non-trivial decision

1. Check if it touches:
    - Public API.
    - Error semantics.
    - Concurrency model.
2. If yes, open `reference/DECISION-TEMPLATE.md` and capture a 5–10 minute ADR.
3. If it changes priorities, update:
    - This file (if phases shift).
    - The relevant cells in `STATUS-MATRIX.md`.

### When you finish a chunk of work

1. Update the relevant rows in `STATUS-MATRIX.md`.
2. If it materially changes a package's state, update `planning/PACKAGE-READINESS.md`.
3. If it was a "big move", add or update an ADR.

---

**Remember**: this gravity well is not a burndown chart.
It exists to keep you orbiting a specific outcome: **v1.0 that you'd trust on a real stage.**
