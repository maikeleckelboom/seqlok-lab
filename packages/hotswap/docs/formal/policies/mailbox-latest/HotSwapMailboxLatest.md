# Hot-Swap Protocol: Mailbox Latest (Latest-Wins)

**Status:** Implemented – TLA⁺ spec and configs present  
**Scope:** Multi-swap behavior with *latest-wins mailbox* overlap handling for `@seqlok/hotswap`  
**Audience:** Seqlok contributors, hotswap implementers, and TLA⁺ authors

This document describes the hot-swap protocol under the **mailbox-latest** policy:

- Overlapping swap requests are **never rejected**.
- While the lane is busy, the host writes the latest intent into a single-slot
  mailbox (overwrite semantics).
- The lane can retarget safely at boundaries (early phases, optional early-fade
  abort, and retire chaining).
- Once the host stops writing, the lane **converges to the last requested
  engine**.

This policy is a good fit for **responsive UI spam** (knobs/sliders, preset
auditioning) where you want “latest intent wins” without queue growth.

---

## Files

```text
packages/hotswap/docs/formal/policies/mailbox-latest/tla/HotSwapMailboxLatest.tla
packages/hotswap/docs/formal/policies/mailbox-latest/tla/HotSwapMailboxLatest.cfg
packages/hotswap/docs/formal/policies/mailbox-latest/tla/HotSwapMailboxLatest.invonly.cfg
```

The spec also depends on a shared primitive:

- `packages/hotswap/docs/formal/primitives/tla/LatestMailboxProtocol.tla`

---

## Relation to other policies

All policies share the same 6-phase lifecycle:

`idle → spawn → prime → prewarm → crossfade → retire → idle`

They differ only in **overlap handling** (what happens if a new request arrives
while `phase != idle`):

- **`single`**: no overlap modeled (one in-flight swap).
- **`reject-busy`**: overlap is rejected immediately.
- **`mailbox-latest`**: overlap is accepted into a mailbox (latest intent wins).

---

## Key semantics (policy rules)

When a request arrives:

- **Idle + target = current engine**: no-op request (accounted for).
- **Idle + target ≠ current engine**: start swap immediately.
- **Busy + target = `nextEngine`**: treat as **reaffirm**:
  - clear any pending retarget intent in the mailbox
  - do **not** restart progress (keep current in-flight swap)
- **Busy + otherwise**: write mailbox:
  - overwrite any existing pending intent
  - advance a **monotonic seqno** to make overwrite/consume ABA-safe

Retarget / consume pending intent happens only at safe boundaries:

- **Early phases** (`spawn | prime | prewarm`): restart swap toward pending.
- **Crossfade**: optional early-fade abort to pending (gated).
- **Retire**: if pending exists, chain immediately (no idle gap).

---

## Proven properties (from the TLA+ model)

### Safety invariants

The model checks invariants such as:

- `TypeOK` (domains)
- `TicketConsistency` (`hasTicket <=> phase != "idle"`)
- `AtMostTwoEngines`
- `NoGapDuringCrossfade`
- `CrossfadeEnginesDistinct`
- `AccountingOK` (every request is accounted for under mailbox semantics)

### Liveness contract

The property the policy is designed to guarantee is:

- **Once the host stops writing**, the lane eventually reaches `idle` on the
  **last requested engine**:
  - `ConvergesToLastAfterDisable`

---

## Transport note

For the shared transport decision (mailbox vs ring), see:

- `../../primitives/TransportArchitecture.md`

