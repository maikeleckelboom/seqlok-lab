# Seqlok: Definition of Done (Gravity Well)

Seqlok is "done" when it is a stable, language agnostic control fabric for real time systems with:

- a locked and minimal API surface
- proven concurrency semantics
- a coherent error and diagnostics story
- a small set of reference integrations that show real use

The sections below describe that target.

## DOD-ARCH: Architecture and packages

### ARCH-1: Layered monorepo is stable and enforced

- Packages and dependency flow:

  - `@seqlok/foundation`: axioms (no dependencies)
  - `@seqlok/primitives`: concurrency and memory (depends on `@seqlok/foundation`)
  - `@seqlok/diagnostics`: diagnostics and environment probing (depends on `@seqlok/foundation`)
  - `@seqlok/core`: spec, plan, backing, handoff and bindings (depends on `@seqlok/foundation`, `@seqlok/primitives`,
    `@seqlok/diagnostics`)
  - `@seqlok/commands`: command transport (depends on `@seqlok/foundation`, `@seqlok/primitives`)
  - `@seqlok/hotswap`: engine lifecycle and swap protocol (depends on `@seqlok/foundation`, `@seqlok/commands`,
    `@seqlok/core`)
  - `@seqlok/integration`: host wiring and topologies (depends on all `@seqlok/*` packages)

- Dependency rules are expressed in tooling (ESLint, dependency graph checks, TypeScript references) and CI fails on
  violations.

### ARCH-2: Ownership of concepts is unambiguous

- Each concern (errors, seqlock, command ring, hotswap protocol, host wiring) has exactly one owning package.
- Public types are exported from that package root barrel. Internal modules are not re exported across package
  boundaries.

### ARCH-3: Memory and layout model is frozen

- Memory planes and packed layouts are versioned and described in docs, including alignment guarantees.
- A minimal layout spec document exists that is enough for a Rust or C++ implementation to interoperate without reading
  the TypeScript source.

## DOD-API: Public surface and semantics

### API-1: Golden flow is final and documented

- Public API centers on:

  ```text
  defineSpec
  -> planLayout
  -> allocateShared | allocateSharedSplit | allocateWasmShared
  -> buildHandoff
  -> receiveHandoff
  -> bindController / bindProcessor / bindObserver
  ```

- No alternative experimental flows are required for normal usage.

### API-2: Param and meter interfaces are stable

- Controller:

  - `params.set(key, value)`
  - `params.update(patch)`
  - `params.stage(key, cb(view))` for arrays
  - `meters.snapshot(...)` for coherent reads (object and positional API)

- Processor:

  - `params.within(cb)` for coherent param read windows
  - `meters.publish(cb)` for coherent meter writes (`writer.scalar(value)`, `writer.stage('arrayKey', cb(view))`)

- DSL ranges are range only (`{min, max}`). There is no `step`, `origin` or `default` in the DSL itself.

### API-3: No legacy names or aliases remain

- No `setMany`, no `adoptHandoff`, no `meters.sample`, no old DSL options.
- Deprecated symbols, if they exist at all, are marked and scheduled for removal with a clear policy.

### API-4: TypeScript experience is first class

- All public APIs are generically typed end to end, with no `any`.
- `defineSpec` to `Plan<S>` to `Handoff<S>` to `ReceivedHandoff<S>` to bindings preserves type information without
  manual casts.
- Example projects build without needing `as never` or `@ts-expect-error` outside of tests.

## DOD-CONC: Concurrency and correctness

### CONC-1: Concurrency model is explicit and documented

- Seqlok documents which data paths are SWMR (params and meters) and which are MWSR or MWMR (command ring, hotswap
  orchestration).
- The seqlock protocol used for params and meters is described in plain language with diagrams.

### CONC-2: Hot paths are property tested

- Property tests cover at least:

  - seqlock coherence with monotone version progression and no torn reads
  - param updates and snapshot invariants with no partial structs
  - hotswap ticket lifecycle, which always reaches a terminal state and keeps at most one active engine per slot

### CONC-3: Concurrency is stress tested

- Node and browser worker tests exist for:

  - cross thread seqlock behavior under load
  - command ring under bursty producers and consumers
  - hotswap transitions while commands are in flight

- A simulated SPARBB style harness runs randomized scenarios (start, stop, swap, abort) and is part of CI.

## DOD-ERR: Errors, diagnostics, health

### ERR-1: Error domains are fully split and stable

- Error codes are partitioned by package:

  - `internal.*`: foundation
  - `primitives.*`: primitives
  - `diagnostics.*`, `env.*`: diagnostics
  - `spec.*`, `plan.*`, `backing.*`, `binding.*`, `handoff.*`: core
  - `commands.*`: commands
  - `hotswap.*`: hotswap
  - `integration.*`: integration

- Each code lives in exactly one `codes/*.ts` file under its owning package.

### ERR-2: Global registry in core aggregates, does not own

- `@seqlok/core` exposes a global registry view:

  - `ErrorCode`, `CodeToPayload`
  - `ERROR_META`, `ERROR_MESSAGES`
  - helpers such as `getErrorMeta`, `getErrorMessage`, `isErrorCode`, `SeqlokError`

- The registry imports domain maps from foundation, primitives, diagnostics and core. It does not know about the
  internals of commands, hotswap or integration.

### ERR-3: Invariants are formalized and enforced

- Invariants include, at minimum:

  - globally unique `code` strings
  - immutable codes after release, with no renames
  - a bijection between code unions and map keys
  - complete metadata and messages, with no orphan entries

- CI has tests that fail on invariant violations.

### ERR-4: JSON schema or IDL exists

- A generated JSON or similar schema describes all error codes, fields and severities.
- Rust or C++ code can be generated from this schema to mirror the TypeScript error surface.

### ERR-5: Diagnostics are structured and documented

- `@seqlok/diagnostics` provides:

  - environment probes for Atomics, shared array buffers, WebAssembly and related features
  - result types that carry structured errors
  - guidance on how hosts should degrade when capabilities are missing

## DOD-PERF: Performance

### PERF-1: Performance budgets are defined

- Clear targets exist for key operations at the level of order of magnitude, not fine tuning. For example:

  - `seqlock.publish`: about one hundred nanoseconds
  - `params.stage` for scalar and array: about one to two hundred nanoseconds
  - `meters.snapshot` on small sets: below one microsecond

- Targets are documented in `docs/performance`.

### PERF-2: Benchmarks are reproducible and tracked

- `pnpm bench` produces machine readable output and a generated markdown summary.
- There is a visible history of benchmark runs, for example checked in JSON or markdown files, so regressions can be
  tracked.

### PERF-3: Performance is part of correctness

- CI includes at least one performance smoke step on a standard machine profile that fails if hot path timings grow
  beyond a reasonable factor.

## DOD-DOCS: Documentation and examples

### DOCS-1: Architecture docs match reality

- The VitePress site includes:

  - an overview of the layer stack (
    `foundation -> primitives and diagnostics -> core -> commands and hotswap -> integration`)
  - a golden flow walkthrough with diagrams
  - the error and diagnostics story, including domain ownership
  - concurrency model diagrams for params and meters and for the command ring

- Docs are kept current enough that a new engineer can implement a small host without reading the entire source tree.

### DOCS-2: API reference is discoverable

- Public exports of each package are documented, at least by hand curated sections rather than only raw generated dumps.
- Each major function has at least one non trivial example.

### DOCS-3: Reference integrations exist

- At least two real examples exist:

  1. a minimal audio adjacent host, such as a simple DSP worker with UI controls, using core bindings
  2. a non audio simulation, such as a WebGPU boids demo, using params and meters and optionally hotswap

- Both live in the repo or in a sibling repo and compile and run against current Seqlok versions.

## DOD-TEST: Testing and CI

### TEST-1: Test coverage is meaningful, not just numeric

- All critical modules, such as spec validation, plan layout, backing allocation, bindings, command ring and hotswap,
  have focused tests.
- Property based tests exist for spec, layout and hotswap invariants.

### TEST-2: Cross environment tests

- The test matrix includes:

  - Node, including worker threads
  - browser equivalent tests, for example Happy DOM with workers or Playwright
  - runs with and without shared array buffers, Atomics and WebAssembly when that is possible

### TEST-3: CI pipeline is canonical

- A single command, for example `pnpm ci`, runs:

  - lint and formatting checks
  - type checking with `tsc -b` across the monorepo
  - unit and integration tests
  - benchmarks or at least a smoke run, optionally gated
  - docs build with VitePress

## DOD-XLANG and HOST: Cross language and integration

### XLANG-1: Interoperability story is real

- A small Rust or C++ prototype exists that:

  - consumes the error schema
  - implements the memory layout spec
  - successfully exchanges params and meters with a JavaScript host that uses a Seqlok style shared memory layout

### XLANG-2: Integration patterns are documented

- `@seqlok/integration` provides patterns or utilities for:

  - worker wiring, including controller, processor and observer topology
  - transport of handoffs and command rings
  - host lifecycle, including start, stop and teardown, with clear error surfaces

- Docs include at least one end to end host wiring chapter.

## DOD-GOV: Versioning and evolution

### GOV-1: Semantic versioning and deprecation policy

- Seqlok follows semantic versioning per package.
- Deprecation rules are documented, including how long symbols live and how error codes are retired.

### GOV-2: Changelog discipline

- Each package has a maintained `CHANGELOG.md` with:

  - sections for breaking changes, features, fixes and internal changes
  - callouts for any changes that affect error codes, layouts or public APIs

---

Treat this as the gravity well. Most changes should move the project toward this shape, not away from it. When most
items on this list are obviously true and new features fit without reopening debates about names, semantics or layering,
Seqlok has become a stable platform instead of a moving target.
