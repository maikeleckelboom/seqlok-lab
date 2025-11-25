# Seqlok v1.0 – DoD Status Matrix

**Last Updated**: 2025-11-24
**Overall Completion**: TBD – this matrix is a tool, not a prediction.

This file mirrors the sections in `../architecture/00-definition-of-done.md` and tracks *your* current assessment.
Rows below start with conservative defaults; update them as you implement work.

---

## Legend

| Symbol | Meaning                   |
|--------|---------------------------|
| ✅      | Complete                  |
| 🟢     | Implemented, needs polish |
| 🟡     | Partial / in progress     |
| 🔴     | Not implemented / blocked |
| ⏸️     | Deferred explicitly       |

---

## DOD-ARCH – Architecture & Packages

**Goal**: Layered monorepo, clear package ownership, frozen layout model.

**Section Status**: 🟡 In progress

| ID | Requirement                                                                                                                         | Status | Notes                                                                                             |
|----|-------------------------------------------------------------------------------------------------------------------------------------|--------|---------------------------------------------------------------------------------------------------|
| A1 | 8-package monorepo structure exists (`foundation`, `primitives`, `diagnostics`, `core`, `commands`, `hotswap`, `integration`, apps) | 🔴     | Core exists; other packages are being designed / scaffolded.                                      |
| A2 | Dependency flow enforced (no upward deps)                                                                                           | 🟡     | `@seqlok/core` has tsconfig project refs; rules for new packages still to be wired.               |
| A3 | Ownership of major concepts documented per package                                                                                  | 🟡     | Architecture docs describe the intended split; per-package README/ownership sections are pending. |
| A4 | Memory layout model documented for x-lang interop                                                                                   | 🟡     | Existing docs describe planes/layout; needs a single normative spec that Rust/C++ can adopt.      |
| A5 | Definition of Done + Gravity Well docs exist                                                                                        | ✅      | DoD + this gravity-well suite exist; they are the planning source of truth.                       |

---

## DOD-API – Public Surface & Semantics

**Goal**: Stable golden flow and param/meter APIs, minimal surface.

**Section Status**: 🟡 Core stable, higher layers missing

| ID | Requirement                                                                                                                      | Status | Notes                                                                  |
|----|----------------------------------------------------------------------------------------------------------------------------------|--------|------------------------------------------------------------------------|
| B1 | Golden flow (`defineSpec → planLayout → allocate* → buildHandoff → receiveHandoff → bindings`) stable in `@seqlok/core`          | 🟢     | Implemented in current core; needs re-validation after monorepo split. |
| B2 | Param/meter APIs (`params.set/update/stage`, `params.within`, `meters.snapshot/publish`) stable and range-only DSL (`{min,max}`) | 🟢     | Behaviourally stable; make sure no legacy DSL fields remain.           |
| B3 | No legacy names/aliases (`setMany`, `adoptHandoff`, `meters.sample`, etc.) remain in public surface                              | 🟡     | Needs a grep + removal pass once v0.3.x refactor lands.                |
| B4 | `@seqlok/commands` public API implemented                                                                                        | 🔴     | Package not implemented yet; only designed.                            |
| B5 | `@seqlok/hotswap` public API implemented                                                                                         | 🔴     | Package not implemented yet; only designed.                            |
| B6 | At least two reference integrations using only public APIs                                                                       | 🔴     | No official reference integrations yet; planned as part of v1.0.       |

---

## DOD-CONC – Concurrency & Correctness

**Goal**: Explicit concurrency model, property/stress tests for hot paths.

**Section Status**: 🟡 Core concurrency solid, commands/hotswap missing

| ID | Requirement                                                                | Status | Notes                                                       |
|----|----------------------------------------------------------------------------|--------|-------------------------------------------------------------|
| C1 | Concurrency model for params/meters (SWMR + seqlock) documented and tested | 🟢     | Docs + tests exist for current core.                        |
| C2 | Command ring concurrency model (MWSR/MWMR as designed) documented          | 🔴     | Depends on `@seqlok/commands` implementation.               |
| C3 | Hotswap invariants: ticket lifecycle + “one active engine per slot”        | 🔴     | Depends on `@seqlok/hotswap` implementation.                |
| C4 | SPARBB-style randomized stress harness for commands + hotswap              | 🔴     | Not implemented; planned once commands/hotswap exist.       |
| C5 | Node + browser worker tests for existing concurrency primitives            | 🟡     | Some tests exist; expand as monorepo and new packages land. |

---

## DOD-ERR – Errors, Diagnostics, Health

**Goal**: Distributed error domains, global registry in core, invariants enforced.

**Section Status**: 🟡 Designed, not migrated

| ID | Requirement                                                                                                                                          | Status | Notes                                                                             |
|----|------------------------------------------------------------------------------------------------------------------------------------------------------|--------|-----------------------------------------------------------------------------------|
| E1 | Error domains split across packages (`internal.*`, `primitives.*`, `diagnostics.*`, `spec.*`, `plan.*`, `backing.*`, `binding.*`, `handoff.*`, etc.) | 🔴     | Concept and migration plan defined; implementation of the split is pending.       |
| E2 | `@seqlok/core` registry aggregates domains without owning them                                                                                       | 🔴     | Current registry is still effectively "central"; must be updated after E1.        |
| E3 | Invariants enforced: global uniqueness, bijection code ↔ maps, complete meta/messages                                                                | 🟡     | Some tests exist for current registry; need to be adapted to distributed domains. |
| E4 | JSON/IDL error schema generated from registry                                                                                                        | 🔴     | Not implemented yet.                                                              |
| E5 | Diagnostics API surfaces structured errors and health guidance                                                                                       | 🟡     | Env probing and diagnostics design exist; package and docs to be completed.       |

---

## DOD-PERF – Performance

**Goal**: Documented budgets, reproducible benches, perf checks in CI.

**Section Status**: 🟡 Core hot paths measured, no CI gate yet

| ID | Requirement                                                   | Status | Notes                                                          |
|----|---------------------------------------------------------------|--------|----------------------------------------------------------------|
| P1 | Benchmarks + budgets defined for core hot paths               | 🟢     | Bench harness exists; results are documented for current core. |
| P2 | Performance for new packages (commands, hotswap) budgeted     | 🔴     | Budgets and benches to be added with implementations.          |
| P3 | Benchmarks can be run reproducibly (`pnpm bench` or similar)  | 🟢     | Exists for core; keep wired as monorepo evolves.               |
| P4 | CI includes at least a perf smoke test (regression guardrail) | 🔴     | Not yet wired into CI.                                         |

---

## DOD-DOCS – Documentation & Examples

**Goal**: Architecture understandable, APIs discoverable, examples runnable.

**Section Status**: 🟡 Core documented, v1.0 story ahead of docs

| ID | Requirement                                                                            | Status | Notes                                                              |
|----|----------------------------------------------------------------------------------------|--------|--------------------------------------------------------------------|
| D1 | Architecture docs for current core golden flow                                         | 🟢     | Docs exist; must be updated after monorepo refactor.               |
| D2 | Docs for new packages (foundation/primitives/diagnostics/commands/hotswap/integration) | 🔴     | No per-package docs yet; use gravity-well + DoD as starting point. |
| D3 | Host wiring / topology guide                                                           | 🔴     | To be written once integration patterns stabilize.                 |
| D4 | Reference integration docs (audio deck + non-audio sim)                                | 🔴     | Planned for v1.0.                                                  |
| D5 | VitePress docs site builds locally and in CI                                           | 🟡     | Local build exists / planned; CI integration to be added.          |

---

## DOD-TEST – Testing & CI

**Goal**: Meaningful coverage, property tests, and a single CI entrypoint.

**Section Status**: 🟡 Core well-tested, new packages missing

| ID | Requirement                                                              | Status | Notes                                                              |
|----|--------------------------------------------------------------------------|--------|--------------------------------------------------------------------|
| T1 | Core (spec/plan/backing/bindings) has focused tests                      | 🟢     | Tests exist for current implementation.                            |
| T2 | Command ring has unit/property/stress tests                              | 🔴     | Not implemented yet.                                               |
| T3 | Hotswap has unit/property/stress tests                                   | 🔴     | Not implemented yet.                                               |
| T4 | Property tests for spec/layout invariants                                | 🟡     | Partial; expand once monorepo and layout spec are frozen.          |
| T5 | Single CI command runs lint, typecheck, tests, benches (optionally docs) | 🟡     | CI exists for current core; update to cover new packages and docs. |

---

## DOD-XLANG – Cross-Language & Integration

**Goal**: Seqlok semantics portable beyond TypeScript.

**Section Status**: 🔴 Mostly future work

| ID | Requirement                                                            | Status | Notes                                                      |
|----|------------------------------------------------------------------------|--------|------------------------------------------------------------|
| X1 | Language-agnostic memory layout spec                                   | 🟡     | Partial doc exists; needs promotion to a canonical spec.   |
| X2 | Error schema consumable by Rust/C++                                    | 🔴     | Depends on DOD-ERR E4.                                     |
| X3 | Minimal Rust prototype (params/meters via shared layout)               | 🔴     | Planned; blocked on X1 + E4.                               |
| X4 | Minimal C++ prototype                                                  | 🔴     | Planned; same dependencies as X3.                          |
| X5 | Integration patterns (workers, handoffs, command transport) documented | 🔴     | Will live under `@seqlok/integration` once package exists. |

---

## DOD-GOV – Versioning & Evolution

**Goal**: Clear versioning, changelog, and deprecation policy.

**Section Status**: 🔴 Governance not wired yet

| ID | Requirement                                              | Status | Notes                                                                                             |
|----|----------------------------------------------------------|--------|---------------------------------------------------------------------------------------------------|
| G1 | Semver per package (not just root)                       | 🔴     | Currently only core/root versioning is in use; per-package semver to be introduced with monorepo. |
| G2 | Changelog per package                                    | 🔴     | No per-package changelogs yet.                                                                    |
| G3 | Deprecation + error code evolution policy documented     | 🔴     | Policy to be written along with v1.0 hardening.                                                   |
| G4 | Commit/CI hooks enforce changelog + version bumps        | 🔴     | Not implemented.                                                                                  |
| G5 | Governance docs describe how to evolve the system safely | 🔴     | To be written as part of v1.0 governance pass.                                                    |

---

## Weekly Usage

At the end of a work block:

1. Update any rows whose status changed.
2. If a new row is needed (e.g. you add a new DOD requirement), append it here and in the DoD doc.
3. Use the **section status** lines as your quick "heat map":

- If **DOD-API**, **DOD-ERR**, or **DOD-CONC** are mostly 🔴/🟡, you are not close to v1.0.
- When most sections are 🟢/✅ and only docs/governance are lagging, you are in v1.0 polishing mode.
