# Policy: `single`

Base hotswap protocol: **one in-flight swap at a time** (no overlap handling).

## Contents

- **English spec**: [`HotSwapSingle.md`](./HotSwapSingle.md)
- **TLA+**: [`tla/HotSwapSingle.tla`](./tla/HotSwapSingle.tla)
- **TLC configs**:
  - Full (safety + liveness): [`tla/HotSwapSingle.cfg`](./tla/HotSwapSingle.cfg)
  - Invariants-only: [`tla/HotSwapSingle.invonly.cfg`](./tla/HotSwapSingle.invonly.cfg)

## Phase lifecycle

All policies share the same 6-phase lifecycle:

`idle → spawn → prime → prewarm → crossfade → retire → idle`

