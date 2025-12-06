# HotSwap Formal Bundle

> Entry point for the formal model, reference C++ spec, and English formal spec.

This directory holds the artefacts that make the hotswap protocol **provable**
and **cross-language**.

---

## 1. Contents

- [`tla/HotSwapProtocol.tla`](./tla/HotSwapProtocol.tla)  
  Source-of-truth TLA+ model of the `@seqlok/hotswap` protocol.

- [`tla/HotSwapProtocol.cfg`](./tla/HotSwapProtocol.cfg)  
  TLC config for checking safety + liveness properties.

- [`tla/HotSwapProtocol.invonly.cfg`](./tla/HotSwapProtocol.invonly.cfg)  
  TLC config for invariants-only runs (faster safety sweeps).

- [`HotSwapProtocol.md`](./HotSwapProtocol.md)  
  English formal spec: phases, state variables, and the full list of
  invariants and temporal properties, mirroring the TLA+ model.

- [`hotswap_spec.reference.hpp`](./hotswap_spec.reference.hpp)  
  Header-only **reference C++ specification** of the protocol state machine.
  This is kept in lockstep with the TypeScript spec and is used for
  cross-checking behavior.
  > Not installed as public ABI; production code includes `<seqlok/hotswap_spec.hpp>`.

- [`SeqlokCoreProtocol.md`](./SeqlokCoreProtocol.md)  
  (Planned / emerging) formal spec for the seqlock-based params/meters
  protocol in `@seqlok/core`. Lives here so all TLA+ lives under one roof.

- [`CommandRingProtocol.md`](./CommandRingProtocol.md)  
  (Planned) TLA+ / English spec for the SWSR command ring protocol that
  drives swap tickets and other RT commands.

Outside this directory but part of the “formal bundle”:

- `../../scripts/tla/run-hotswap.ts`  
  CLI helper for running TLC with the right configs from the workspace root.

---

## 2. How the pieces relate

High-level relationships:

- **HotSwapProtocol.tla**  
  → canonical mathematical model of the swap protocol.

- **HotSwapProtocol.md**  
  → human-readable explanation of the same model (phases, invariants,
  properties).

- **hotswap_spec.reference.hpp**  
  → C++ template state machine that matches the TS implementation and is
  traceable back to the TLA+ model. Good for:
  - Cross-language conformance tests
  - Native engine runtimes
  - Asserting the RT surface is allocation-free / lock-free

- **SeqlokCoreProtocol / CommandRingProtocol**  
  → sibling specs for the other core protocols (seqlock params/meters and
  command rings). Those aren’t required to understand hotswap, but live here
  to keep all formal work together.

For overview / orientation of the whole package, see the docs root:

- [`../README.md`](../README.md)

---

## 3. Running the model

### 3.1 Via workspace script

From the repo root:

```bash
pnpm ts-node scripts/tla/run-hotswap.ts
````

That script is responsible for:

* Invoking `tla2tools.jar` with `HotSwapProtocol.tla`
* Choosing `HotSwapProtocol.cfg` or `HotSwapProtocol.invonly.cfg`
* Wiring log/output paths into the workspace

(See the script itself for exact flags and environment.)

### 3.2 Manually with TLA+ Toolbox / CLI

For ad-hoc runs or debugging, you can also:

* Use TLA+ Toolbox and open `tla/HotSwapProtocol.tla`, or
* Run `java -jar tla2tools.jar -config tla/HotSwapProtocol.cfg tla/HotSwapProtocol.tla`

Detailed step-by-step instructions live in
[HotSwapProtocol.md](./HotSwapProtocol.md).

---

## 4. Invariants & properties

The canonical list of safety / liveness properties lives in:

* [HotSwapProtocol.md](./HotSwapProtocol.md) — table form, with explanations.
* [tla/HotSwapProtocol.tla](./tla/HotSwapProtocol.tla) — as `INVARIANTS` and
  `PROPERTIES` blocks.

If you add or change invariants:

1. Update the TLA+ file.
2. Update the English description in `HotSwapProtocol.md`.
3. Update any conformance tests and `test-vectors.json` in
   `../archive/test-vectors.json` if behavior changes.

This keeps TS, C++, and the formal model in lockstep.
