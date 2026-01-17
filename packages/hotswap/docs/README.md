# @seqlok/hotswap docs

> Map of the hotswap docs folder: where to start and what is normative.

This directory explains the hot-swap protocol from three angles:

- **Contract:** what the host and engines MUST do.
- **Implementation:** how Seqlok/Dekzer actually wires it.
- **Formal + reference:** TLA+ spec and cross-checked C++/TS state machines.

---

## 1. Document map

### Core docs

- [CONTRACT.md](./CONTRACT.md)  
  Normative contract between the hotswap driver and engines (Levels 1–2).  
  Read this first if you are changing protocol behavior or driver semantics.

- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)  
  How the composite driver, SwapTicket, and command ring glue together in
  real code. This is the "how to wire it in a real system" companion to the
  contract.

### Engine author docs

- [engine/engine-architecture-vision.md](./engine/engine-architecture-vision.md)  
  High-level vision for the engine ecosystem and how hotswap fits into it.

- [engine/engine-lifecycle-spec.md](./engine/engine-lifecycle-spec.md)  
  Concrete lifecycle for engines: create -> prime -> pre-warm -> crossfade ->
  retire. If you are implementing an engine, this is your main spec.

- [engine/engine-sdk-guide.md](./engine/engine-sdk-guide.md)  
  SDK-style guide for DSP authors who want their engines to plug into Seqlok
  and benefit from sample-accurate swaps.

### Formal + reference bundle

- [formal/README.md](./formal/README.md)  
  Entry point for the formal model and reference artefacts:
  - TLA+ specs (single-swap and multi-swap)
  - Reference C++ header
  - English formal specs

If you care about **invariants, model checking, or cross-language parity**,
start there.

### ADRs and archive

- [adr/hotswap-multi-swap-requirements.md](adr/hotswap-multi-swap-requirements.md)  
  Requirements and constraints for Level 2 (`reject-busy`) behavior.

- [adr/hotswap-advanced-multi-swap-exploratory.md](adr/hotswap-advanced-multi-swap-exploratory.md)  
  Exploratory Level 3+ behavior (queues, retarget, fancy policies). Vision
  only; **not** binding for v0.3.x.

- [archive/stretch-engine-config-v0-design.md](./archive/stretch-engine-config-v0-design.md)  
  Older stretch-engine configuration design kept for historical context.

---

## 2. Who should read what?

- **Seqlok/Dekzer core devs**  
  Start with:
  - [CONTRACT.md](./CONTRACT.md)
  - [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)
  - [formal/policies/single/HotSwapSingle.md](./formal/policies/single/HotSwapSingle.md) for base invariants
  - [formal/policies/reject-busy/HotSwapRejectBusy.md](./formal/policies/reject-busy/HotSwapRejectBusy.md) for multi-swap

- **Engine authors (DSP / C++)**  
  Start with:
  - [engine/engine-lifecycle-spec.md](./engine/engine-lifecycle-spec.md)
  - [engine/engine-sdk-guide.md](./engine/engine-sdk-guide.md)
  - [formal/hotswap_spec.reference.hpp](formal/reference/cpp/hotswap_spec.reference.hpp) as
    the reference state machine (kept in sync with the TS spec).

- **Formal / verification people**  
  Start with:
  - [formal/README.md](./formal/README.md)
  - [formal/policies/single/HotSwapSingle.md](./formal/policies/single/HotSwapSingle.md)
  - [formal/policies/reject-busy/HotSwapRejectBusy.md](./formal/policies/reject-busy/HotSwapRejectBusy.md)
  - [formal/policies/mailbox-latest/HotSwapMailboxLatest.md](./formal/policies/mailbox-latest/HotSwapMailboxLatest.md)
  - `formal/policies/**/tla/*.tla` specs and configs

---

## 3. Invariants and levels

This docs tree uses a small, *historical* level taxonomy for what is supported:

- **Level 1 = policy `single`**  
  Base single-swap protocol: at most one in-flight swap per lane/slot.

- **Level 2 = policy `reject-busy`**  
  Overlap is explicitly defined as: **reject while busy**. No queue, no retarget,
  no coalesce.

- **Level 3+ = Experimental / Future (not part of supported Levels 1–2)**  
  Anything beyond “reject while busy” lives here. Today that includes:
  - `mailbox-latest` (**EXPERIMENTAL**, treat as “Level 3” if you want a number)
  - Retarget/coalesce concepts are future-only (Level 3+); see adr/hotswap-advanced-multi-swap-exploratory.md.

For the full list of invariants (safety + liveness), see:

- [formal/policies/single/HotSwapSingle.md](./formal/policies/single/HotSwapSingle.md) - Base protocol invariants
- [formal/policies/reject-busy/HotSwapRejectBusy.md](./formal/policies/reject-busy/HotSwapRejectBusy.md) - Multi-swap invariants
- [formal/policies/mailbox-latest/HotSwapMailboxLatest.md](./formal/policies/mailbox-latest/HotSwapMailboxLatest.md) - Latest-wins overlap handling (**EXPERIMENTAL**)
- The TLA+ specs in `formal/policies/**/tla/` contain formal definitions

---

## 4. Running formal verification

From the repo root:

```bash
# Base protocol (single swap)
pnpm tla:hotswap              # Fast invariants-only
pnpm tla:hotswap:full         # Full with liveness

# Multi-swap with reject-while-busy
pnpm tla:hotswap -- --policy reject-busy
pnpm tla:hotswap:full -- --policy reject-busy

# EXPERIMENTAL: mailbox-latest overlap handling (may currently fail invariants)
pnpm tla:hotswap -- --policy mailbox-latest
pnpm tla:hotswap:full -- --policy mailbox-latest
```

See [formal/README.md](./formal/README.md) for detailed instructions.

---

## 5. Policy-based naming

The TLA+ specs use policy-based names instead of arbitrary level numbers:

| Policy            | Spec                        | Level | Description                       |
|------------------|-----------------------------|-------|-----------------------------------|
| `single`         | HotSwapSingle.tla           | 1     | Base single-swap protocol         |
| `reject-busy`    | HotSwapRejectBusy.tla       | 2     | Overlap defined as reject-while-busy |
| `mailbox-latest` | HotSwapMailboxLatest.tla    | 3     | **EXPERIMENTAL**: latest-wins mailbox |

Levels 1–2 are the supported taxonomy. Anything beyond that should be treated
as **experimental/future**, not as a supported “Level 2.x”.

---

## 6. Cross-language conformance

All implementations (TypeScript, C++, future Rust/Zig) must:

1. Implement the same state machine as defined in the TLA+ specs
2. Pass the same test vectors in `archive/test-vectors.json`
3. Maintain the same invariants (verified by property tests)

The reference C++ implementation (`formal/hotswap_spec.reference.hpp`) is kept
in lockstep with the TypeScript implementation and both are traceable to the
TLA+ models.
