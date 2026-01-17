# Policy: `mailbox-latest`

Multi-swap semantics with **latest-wins mailbox** overlap handling.

If swaps are requested while the lane is busy, the host **never rejects**:
it writes the latest intent into a single-slot mailbox (overwriting any prior
pending intent). The lane converges to the last requested engine once requests
stop.

## Contents

- **English spec**: [`HotSwapMailboxLatest.md`](./HotSwapMailboxLatest.md)
- **TLA+**: [`tla/HotSwapMailboxLatest.tla`](./tla/HotSwapMailboxLatest.tla)
- **TLC configs**:
  - Full (includes liveness): [`tla/HotSwapMailboxLatest.cfg`](./tla/HotSwapMailboxLatest.cfg)
  - Invariants-only: [`tla/HotSwapMailboxLatest.invonly.cfg`](./tla/HotSwapMailboxLatest.invonly.cfg)

## Phase lifecycle

All policies share the same 6-phase lifecycle:

`idle → spawn → prime → prewarm → crossfade → retire → idle`

