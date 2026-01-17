# Policy: `reject-busy`

Multi-swap semantics with **reject-while-busy** overlap handling.

If a swap is requested while the lane is busy, the host rejects it immediately
(no queueing, no overwrite).

## Contents

- **English spec**: [`HotSwapRejectBusy.md`](./HotSwapRejectBusy.md)
- **TLA+**: [`tla/HotSwapRejectBusy.tla`](./tla/HotSwapRejectBusy.tla)
- **TLC configs**:
  - Full (safety + liveness): [`tla/HotSwapRejectBusy.cfg`](./tla/HotSwapRejectBusy.cfg)
  - Invariants-only: [`tla/HotSwapRejectBusy.invonly.cfg`](./tla/HotSwapRejectBusy.invonly.cfg)

## Phase lifecycle

All policies share the same 6-phase lifecycle:

`idle → spawn → prime → prewarm → crossfade → retire → idle`

