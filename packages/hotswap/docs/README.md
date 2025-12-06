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
  Normative contract between the hotswap driver and engines (Level 2.5).  
  Read this first if you are changing protocol behavior or driver semantics.

- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)  
  How the composite driver, SwapTicket, and command ring glue together in
  real code. This is the “how to wire it in a real system” companion to the
  contract.

### Engine author docs

- [engine/engine-architecture-vision.md](./engine/engine-architecture-vision.md)  
  High-level vision for the engine ecosystem and how hotswap fits into it.

- [engine/engine-lifecycle-spec.md](./engine/engine-lifecycle-spec.md)  
  Concrete lifecycle for engines: create → prime → pre-warm → crossfade →
  retire. If you are implementing an engine, this is your main spec.

- [engine/engine-sdk-guide.md](./engine/engine-sdk-guide.md)  
  SDK-style guide for DSP authors who want their engines to plug into Seqlok
  and benefit from sample-accurate swaps.

### Formal + reference bundle

- [formal/README.md](./formal/README.md)  
  Entry point for the formal model and reference artefacts:
  TLA+ spec, reference C++ header, and English formal spec.

If you care about **invariants, model checking, or cross-language parity**,
start there.

### ADRs and archive

- [adr/hotswap-multi-swap-requirements.md](./adr/hotswap-multi-swap-requirements.md)  
  Requirements and constraints for multi-swap / Level 2.5 behavior.

- [adr/hotswap-level-3-advanced-multi-swap-exploratory.md](./adr/hotswap-level-3-advanced-multi-swap-exploratory.md)  
  Exploratory Level 3+ behavior (queues, retarget, fancy policies). Vision
  only; **not** binding for v0.3.x.

- [archive/stretch-engine-config-v0-design.md](./archive/stretch-engine-config-v0-design.md)  
  Older stretch-engine configuration design kept for historical context.

- [archive/test-vectors.json](./archive/test-vectors.json)  
  Golden test vectors for swap sequences. TS, C++, and any other impls must
  agree on these.

---

## 2. Who should read what?

- **Seqlok/Dekzer core devs**  
  Start with:
  - [CONTRACT.md](./CONTRACT.md)
  - [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)
  - [formal/HotSwapProtocol.md](./formal/HotSwapProtocol.md) for invariants.

- **Engine authors (DSP / C++)**  
  Start with:
  - [engine/engine-lifecycle-spec.md](./engine/engine-lifecycle-spec.md)
  - [engine/engine-sdk-guide.md](./engine/engine-sdk-guide.md)
  - [formal/hotswap_spec.reference.hpp](./formal/hotswap_spec.reference.hpp) as
    the reference state machine (kept in sync with the TS spec).

- **Formal / verification people**  
  Start with:
  - [formal/README.md](./formal/README.md)
  - [formal/HotSwapProtocol.md](./formal/HotSwapProtocol.md)
  - `formal/tla/HotSwapProtocol.tla` + configs.

---

## 3. Invariants and levels

The protocol docs assume the Level 2.5 scope:

- Single deck, at most one active swap ticket.
- No queued or retargeted swaps (those live in Level 3 ADRs).
- Strict “spawn + prime + prewarm + crossfade + retire” discipline
  (no live configure on the active engine).

For the full list of invariants (safety + liveness), see:

- [formal/HotSwapProtocol.md](./formal/HotSwapProtocol.md) – English version.
- [formal/tla/HotSwapProtocol.tla](./formal/tla/HotSwapProtocol.tla) – TLA+.
