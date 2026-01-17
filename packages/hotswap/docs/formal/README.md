# HotSwap Formal Bundle

> Entry point for the formal model, reference C++ spec, and English formal spec.

This directory holds the artefacts that make the hotswap protocol **provable**
and **cross-language**.

---

## 1. Contents

### Policies (TLA+ + English spec)

- **`single`**
  - [`policies/single/`](./policies/single/)

- **`reject-busy`**
  - [`policies/reject-busy/`](./policies/reject-busy/)

- **`mailbox-latest`**
  - [`policies/mailbox-latest/`](./policies/mailbox-latest/)

Each policy folder is intended to be self-contained:
English spec + `tla/` module + TLC configs.

### Reference Implementation

- [`reference/cpp/hotswap_spec.reference.hpp`](reference/cpp/hotswap_spec.reference.hpp)  
  Header-only **reference C++ specification** of the protocol state machine.
  Kept in lockstep with the TypeScript spec for cross-language verification.

  > Not installed as public ABI; production code includes `<seqlok/hotswap_spec.hpp>`.

### Primitives (shared building blocks)

- [`primitives/README.md`](./primitives/README.md)

### Tooling

Outside this directory but part of the "formal bundle":

- `../../scripts/tla/run-hotswap.ts`  
  CLI helper for running TLC with policy-based selection.

---

## 2. How the pieces relate

High-level relationships:

- **HotSwapSingle.tla**  
  Canonical mathematical model of a single swap. Proves the base protocol is
  correct (2.9M states, 2+ minutes).

- **HotSwapRejectBusy.tla**  
  Extends the base model to verify multi-swap scenarios with reject-while-busy
  policy. Proves sequential swaps work correctly (~1k states, <1 second with
  request limit).

- **English policy docs**  
  Human-readable explanations of the models (phases, invariants, properties),
  one folder per policy under `policies/`.

- **reference C++** (`reference/cpp/`)  
  C++ template state machine matching the TS implementation and traceable to
  the TLA+ models. Good for:
  - Cross-language conformance tests
  - Native engine runtimes
  - Verifying RT surface is allocation-free / lock-free

- **primitives** (`primitives/`)  
  Shared building blocks (transport notes, mailbox primitive TLA+, planned ring/coherence stubs).

For overview / orientation of the whole package, see:

- [`../README.md`](../README.md)

---

## 3. Running the model

### 3.1 Via workspace script

From the repo root:

```bash
# Single-swap protocol (default)
pnpm tla:hotswap              # Fast invariants-only
pnpm tla:hotswap:full         # Full verification with liveness

# Multi-swap with reject-while-busy
pnpm tla:hotswap -- --policy reject-busy
pnpm tla:hotswap:full -- --policy reject-busy
```

The script (`scripts/tla/run-hotswap.ts`) is responsible for:

- Selecting the correct .tla file based on --policy flag
- Choosing between full and invonly configs
- Wiring log/output paths into the workspace

### 3.2 Manually with TLA+ Toolbox / CLI

For ad-hoc runs or debugging:

**Single-swap:**

```bash
java -jar tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.cfg \
  packages/hotswap/docs/formal/policies/single/tla/HotSwapSingle.tla
```

**Multi-swap:**

```bash
java -jar tla2tools.jar \
  -config packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.cfg \
  packages/hotswap/docs/formal/policies/reject-busy/tla/HotSwapRejectBusy.tla
```

Or use TLA+ Toolbox GUI and open the respective .tla files.

Detailed step-by-step instructions live in the individual spec docs.

---

## 4. Invariants and properties

The canonical list of safety / liveness properties lives in:

- **Single-swap:** [`policies/single/HotSwapSingle.md`](./policies/single/HotSwapSingle.md)
- **Reject-busy:** [`policies/reject-busy/HotSwapRejectBusy.md`](./policies/reject-busy/HotSwapRejectBusy.md)
- **Mailbox-latest:** [`policies/mailbox-latest/HotSwapMailboxLatest.md`](./policies/mailbox-latest/HotSwapMailboxLatest.md)
- The .tla files themselves contain the formal definitions

### Common Safety Invariants (both specs)

- `TypeOK` - All variables in valid domains
- `AtMostTwoEngines` - Never more than 2 engines active
- `NoGapDuringCrossfade` - Both engines active during crossfade
- `NextEngineConsistency` - Next engine only during swaps
- `PhaseTicketConsistency` - Non-idle phases require active ticket

### Multi-Swap Specific Invariants

- `SequentialSwapsComplete` - Sequential swaps (A->B->C) end correctly
- `NoRejectedEngineInDecisions` - Rejected engines never appear in decisions
- `CompletedSwapsConsistency` - History tracking is accurate

### Common Liveness Properties

- `EventuallyIdle` - Every accepted swap completes
- `NoLivelock` - Never stuck in intermediate phases

---

## 5. Policy-based naming

The TLA+ specs use a **policy-based naming system** that aligns with
requirements documents:

| Policy Name    | TLA+ Spec             | Requirements Doc | What It Proves                      |
|----------------|-----------------------|------------------|-------------------------------------|
| `single`       | HotSwapSingle.tla     | Level 2.0        | Base protocol for one swap          |
| `reject-busy`  | HotSwapRejectBusy.tla | Level 2.5        | Multi-swap with immediate rejection |
| `mailbox-latest` | HotSwapMailboxLatest.tla | Level 2.6     | Multi-swap with latest-wins mailbox |
| `queued` (TBD) | HotSwapQueued.tla     | Level 3.0        | Queued swaps (future)               |

This replaces the older "Level 2.5" naming in spec files, though ADRs still
use level numbers for requirements tracking.

---

## 6. Verification results

As of the latest run:

| Spec              | States | Time   | Result |
|-------------------|--------|--------|--------|
| HotSwapSingle     | 2.3M   | 2min   | PASS   |
| HotSwapRejectBusy | ~1k    | <1 sec | PASS   |

The multi-swap spec uses bounded exploration (`swapRequests <= 10`) to keep
verification tractable while still proving correctness of the reject-while-busy
policy.

---

## 7. Updating the specs

If you add or change invariants:

1. Update the relevant .tla file (HotSwapSingle or HotSwapRejectBusy)
2. Update the corresponding .md file with English descriptions
3. Update conformance tests if behavior changes
4. Update `test-vectors.json` in `../archive/` if state sequences change
5. Run both TS and C++ test suites to verify parity

This keeps TS, C++, and the formal models in lockstep.

---

## 8. Further reading

- [Lamport's TLA+ Home](https://lamport.azurewebsites.net/tla/tla.html)
- [Learn TLA+ (Practical Guide)](https://learntla.com/)
- [Specifying Systems (Free Book)](https://lamport.azurewebsites.net/tla/book.html)
- [Hillel Wayne's TLA+ Guide](https://www.hillelwayne.com/post/tla-messages/)

---

## 9. Why this matters for real-time audio

In RT audio, bugs don't just cause crashes - they cause **audible glitches**
that destroy user experience. The constraints are unforgiving:

- No allocation in the hot path
- No blocking
- Bounded, predictable execution time
- No race conditions or torn reads

By formally specifying the protocol and proving safety/liveness properties, we
have mathematical confidence that the **design** is correct before writing
implementation code.

The implementation can still have bugs (wrong array index, off-by-one, etc.),
but the **protocol structure** is proven sound.
