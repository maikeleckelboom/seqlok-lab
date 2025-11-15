# Backing & Plane Layout (Internals)

Deterministic, allocation-free memory mapping for Seqlok.

This doc explains how a validated **Plan** turns into concrete shared memory **Backings** and **TypedArray views**,
including plane layout, alignment, and packing rules.

It's written for people working _inside_ Seqlok (or doing advanced diagnostics), not for everyday users of
`@seqlok/core`.

---

## 1. Mental Model: From Spec to Views

There are two parallel ways to think about the pipeline:

### 1.1 User-facing pipeline (golden path)

```ts
const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

const handoff = buildHandoff(plan, backing);
// send `handoff` to another agent...

const received = receiveHandoff(handoff);
const controller = bindController(spec, backing);
const processor = bindProcessor(spec, received);
```

From the user's point of view:

- `allocateShared(plan)` gives you "the memory".
- `buildHandoff(plan, backing)` gives you "the envelope".
- `bindController` / `bindProcessor` give you "the APIs".

The _views_ and seqlocks are internal concerns of the backing + bindings code.

---

### 1.2 Internal mental model

Internally, we still reason in terms of:

[
\text{Spec} \xrightarrow{\text{planLayout}} \text{Plan}
\xrightarrow{\text{allocate}}\text{Backing}
\xrightarrow{\text{mapViews}}\text{Views}
]

| Component   | Role                                       | Output / contents                                             |
| :---------- | :----------------------------------------- | :------------------------------------------------------------ |
| **Spec**    | User-defined param/meter structure         | —                                                             |
| **Plan**    | Blueprint (plane sizes, offsets, slots)    | Total bytes, per-plane byte lengths, slot tables, hashes      |
| **Backing** | Concrete shared storage shaped by the plan | Contiguous SAB / per-plane SABs / shared `WebAssembly.Memory` |
| **Views**   | TypedArray accessors per plane + seqlock   | `PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`      |

> **Indexing rule:** slot tables use **byte** `offset` and **element** `length`.
> TypedArray index is always `elemIndex = byteOffset / BYTES_PER_ELEM[plane]`.

`mapViews(plan, backing)` is the internal/advanced helper that does the offset math and produces the plane-level
TypedArrays and `SeqPair`s for bindings. It is **not** part of the golden public flow and is never used from the
processor side.

---

## 2. Planes, Alignment, and Packing

### 2.1 Canonical planes & element sizes

These match the primitives doc and are the only planes used in ABI v1:

| Plane  | Purpose       | Data stored                                       | Elem size |
| :----- | :------------ | :------------------------------------------------ | :-------- |
| `PF32` | Param payload | `f32` scalars + `f32.array` elements              | 4 bytes   |
| `PI32` | Param payload | `i32` scalars + `i32.array` + **enum indices**    | 4 bytes   |
| `PB`   | Param payload | `bool` / `bool.array` as 0/1                      | 1 byte    |
| `PU`   | Param control | Param seqlock control words `[LOCK, SEQ]`         | 4 bytes   |
| `MF32` | Meter payload | `f32` scalars + `f32.array`                       | 4 bytes   |
| `MF64` | Meter payload | `f64` scalars + `f64.array` (hi-res time / stats) | 8 bytes   |
| `MU32` | Meter payload | `u32` counters/flags, **bool meters as 0/1**      | 4 bytes   |
| `MU`   | Meter control | Meter seqlock control words `[LOCK, SEQ]`         | 4 bytes   |

Conventions:

- Bool **params**: `PB` (0/1 bytes).
- Bool **meters**: `MU32` (0/1 u32).
- Seqlock control is always `Uint32Array` (`PU` and `MU`).

> **No DSL leakage.** Planes contain **raw numeric payload only** (floats, ints, counters, indices, flags).
> Enum labels, ranges, etc., live entirely in the spec + bindings – never in the planes.

---

### 2.2 Alignment & packing rules

The planner enforces simple, predictable rules:

1. **Plane alignment**

   Each plane's base offset must be aligned to its element size:

- `PF32`, `PI32`, `PU`, `MF32`, `MU32`, `MU` → 4-byte alignment
- `MF64` → 8-byte alignment
- `PB` → 1-byte alignment (trivially satisfied)

2. **Packing order (stable)**

   Global packing order is fixed and deterministic:

   ```text
   PF32 → PI32 → PB → PU → MF32 → MF64 → MU32 → MU
   ```

   That order is part of the ABI; changing it would be a breaking change.

3. **Packing loop**

   For each plane in that order:

- Align the cursor to `BYTES_PER_ELEM[plane]` using `roundUpTo`.
- Record `planeBaseOffset[plane] = cursor`.
- Advance `cursor += planeByteLength[plane]`.

The final cursor value is `bytesTotal` for `allocateShared(plan)`.

We rely on helpers from the primitives module:

```ts
roundUpTo(offset, BYTES_PER_ELEM[plane]);
isAligned(offset, plane); // invariant checks
```

If `isAligned` ever fails for a planned offset, that's a _plan bug_ and triggers an internal assertion.

---

### 2.3 Control planes: seqlock layout

Control planes `PU` and `MU` hold exactly the seqlock words for their domain:

| Index | Meaning | Role                                                       |
| :---- | :------ | :--------------------------------------------------------- |
| `0`   | `LOCK`  | Odd during write, even when quiescent                      |
| `1`   | `SEQ`   | Increments exactly once per successful commit (“one bump”) |

The planner guarantees:

- There is exactly **one** param seqlock pair (`PU`) per backing.
- There is exactly **one** meter seqlock pair (`MU`) per backing.

Bindings then wrap these via `createSeqPair`:

```ts
const paramSeq = createSeqPair(PU, lockIndexP, seqIndexP);
const meterSeq = createSeqPair(MU, lockIndexM, seqIndexM);
```

> **Implementation note (optional):**
> Internally we _may_ pad these control planes out to a cache-line size (e.g. 64 B) to reduce false sharing.
> This is an implementation detail, not a public ABI guarantee.

---

## 3. Backing Flavors

Backings are "how a Plan becomes actual memory". All flavors respect the same plan; bindings see the same logical layout
and offsets regardless of backing flavor.

The three main strategies:

| Flavor        | Container                                     | Mapping                                  | Use case                                     |
| :------------ | :-------------------------------------------- | :--------------------------------------- | :------------------------------------------- |
| `Shared`      | **One** `SharedArrayBuffer`                   | All planes slice the same SAB            | Golden path: best locality, simplest handoff |
| `SharedSplit` | **One SAB per plane**                         | Each plane has its own SAB               | Advanced: isolation, tooling, debugging      |
| `WasmShared`  | **One** `WebAssembly.Memory` (`shared: true`) | All views map over `memory.buffer` (SAB) | Advanced: WASM DSP engine owns the memory    |

### 3.1 Public backing entry points

Backings are created/attached via the backing layer:

```ts
// Contiguous SAB (golden path)
export function allocateShared(plan: Plan): SharedBacking;

// Separate SAB per plane (advanced)
export function allocateSharedSplit(plan: Plan): SplitBacking;

// Shared WebAssembly.Memory (advanced)
export function allocateWasmShared(plan: Plan, memory: WebAssembly.Memory): WasmBacking;
```

Characteristics:

- All three expect a **validated Plan**.
- All enforce **bytesTotal** and per-plane byte-length invariants.
- All throw typed `SeqlokError`s from the backing or env domains on failure.

Bindings (`bindController`, `bindProcessor`) work against a normalized `Backing` abstraction; they do not care which
flavor produced it.

---

### 3.2 Shared (contiguous) – golden path

`allocateShared(plan)`:

- Allocates a single `SharedArrayBuffer(bytesTotal)`.
- Computes per-plane base offsets per the packing rules.
- Records the SAB and the per-plane slices in the backing structure.

Benefits:

- Best cache locality.

- Simple `buildHandoff(plan, backing)` envelope:

  - One SAB reference.
  - Plan metadata (hash, bytesTotal, per-plane lengths).

- Easiest to reason about for both JS and WASM consumers.

This is the **default** path used by examples and recommended for most use cases.

---

### 3.3 SharedSplit – one SAB per plane

`allocateSharedSplit(plan)`:

- Allocates one SAB per plane:

  ```ts
  PF32: new SharedArrayBuffer(bytes.PF32)
  PI32: new SharedArrayBuffer(bytes.PI32)
  ...
  ```

- Still uses the same per-plane lengths as the plan; base offsets are implicitly `0` for each plane.

- Returns a backing that implements the same logical `Backing` interface as `allocateShared`.

Reasons you might want this:

- Debugging / instrumentation tooling that needs to observe/replace planes individually.
- Exotic memory governance setups where different planes have different lifetimes or budgets.

Drawbacks:

- Slightly worse locality (more dispersed memory).
- Handoff becomes more complex if exposed across agents (more SAB links).

---

### 3.4 WasmShared – shared WebAssembly.Memory

`allocateWasmShared(plan, memory)`:

- Ensures `memory.buffer` is:

  - A `SharedArrayBuffer`.
  - Large enough to hold the planned layout at the chosen base offset.

- Computes plane base offsets inside `memory.buffer` using the same packing rules as `allocateShared`.

- Returns a backing whose planes are just slices/views into `memory.buffer`.

This is intended for:

- Architectures where a WASM DSP engine (Rust/C/C++) owns a shared `WebAssembly.Memory`.
- JS is "binding into" that memory rather than owning it.

Constraints:

- Growth of `memory` **after** binding is allowed as long as the original layout remains valid (no shrink).
- Shrinking or reusing `memory` for a different plan breaks invariants and is considered undefined behavior.

---

## 4. Mapping Plan → Views

### 4.1 `mapViews(plan, backing)` (internal / advanced)

`mapViews` is the function that turns:

- `Plan` (byte lengths, base offsets, slot tables)
- `Backing` (SABs or `WebAssembly.Memory.buffer`)

into a bundle of concrete TypedArrays and seqlock pairs:

- `Float32Array` / `Float64Array` / `Int32Array` / `Uint8Array` / `Uint32Array` instance per plane.
- `SeqPair` for params (`PU`) and meters (`MU`).

Conceptually:

```ts
const views = mapViews(plan, backing);

// example bits inside:
views.PF32 = new Float32Array(sab, base.PF32, bytes.PF32 / 4);
views.MF64 = new Float64Array(sab, base.MF64, bytes.MF64 / 8);
// ...
views.paramSeq = createSeqPair(views.PU, lockIndexP, seqIndexP);
views.meterSeq = createSeqPair(views.MU, lockIndexM, seqIndexM);
```

**Invariants:**

- Each view's `byteOffset` equals the planned base offset for that plane.
- `views[plane].byteLength` exactly matches `plan.bytes[plane]`.
- `isAligned(baseOffset, plane)` holds for all planes.
- `paramSeq` and `meterSeq` line up with the intended seqlock slots.

> **Policy:** `mapViews` is **never** called from the processor side in normal usage.
> Processor gets a `ReceivedHandoff` and `bindProcessor` builds its views entirely from that.

---

### 4.2 Bindings and seqlock integration

Bindings consume `mapViews` output and primitives:

- Controller binding:

  - Uses param views + param `SeqPair` → `params.set` / `params.update`.
  - Uses meter views + meter `SeqPair` → `meters.snapshot` / `meters.version`.

- Processor binding:

  - Uses param views + param `SeqPair` → `params.within`.
  - Uses meter views + meter `SeqPair` → `meters.publish` / `meters.stage`.

Crucially:

- The backing layer never embeds spec semantics.
- The bindings layer never makes assumptions about physical layout beyond what the plan gives it.

---

## 5. Error Conditions & Environment

### 5.1 Backing & mapping errors

Typical backing-domain errors:

| Condition                         | Error code                 | Notes                                             |
| :-------------------------------- | :------------------------- | :------------------------------------------------ |
| Buffer too small for `bytesTotal` | `backing.undersized`       | Indicates a broken allocator or mismatched plan   |
| WASM memory not shared            | `backing.wasmNotShared`    | `memory.buffer` must be a `SharedArrayBuffer`     |
| Misaligned offset (internal bug)  | `internal.assertionFailed` | Indicates a broken planner or backing layout code |

None of these errors are "recoverable" in a meaningful way; they should be treated as configuration / programming
faults.

### 5.2 Environment constraints

Environment-domain preconditions (roughly):

- Browsers:

  - `SharedArrayBuffer` requires **cross-origin isolation** (COOP/COEP headers).
  - Workers / AudioWorklets must have access to the same agent cluster.

- Node / runtime:

  - Requires support for shared memory (e.g. `worker_threads`).
  - `SharedArrayBuffer` / `Atomics` must not be disabled.

Typical strategy:

- Backing allocators check these conditions once and throw an `env.*` error domain code if shared memory is unavailable.
- Callers are expected to _fail fast_ and either:

  - Disable Seqlok-backed features, or
  - Refuse to start a configuration that claims to be "real-time" but lacks SAB.

There is **no** postMessage/clone "fallback" mode; emulating shared memory with copies would violate Seqlok's
guarantees.

---

## 6. Backing Variants & ABI Stability

Although backing implementations can evolve internally (extra padding, different SAB allocation strategies, etc.), the
ABI constraints for v1 are:

- Plane set is fixed: `PF32`, `PI32`, `PB`, `PU`, `MF32`, `MF64`, `MU32`, `MU`.
- Packing order is fixed and deterministic.
- Plane byte lengths and base offsets are determined **only by** the Plan.
- Control planes `PU`/`MU` always contain a single seqlock pair `[LOCK, SEQ]`.
- Backing flavor is not observable through the binding APIs – only performance and debug tooling may care.

As long as those invariants hold, backings are interchangeable from the perspective of:

- `buildHandoff` / `receiveHandoff`
- `bindController` / `bindProcessor`
- The concurrency model documented elsewhere.

---

## 7. Design Intent

Backing & plane layout code has a very specific personality:

- **Backings are dumb.**

  - They know about bytes, SABs, and TypedArray views.
  - They do **not** know about "filters", "meters", "params", or any domain semantics.

- **All cleverness lives in Plan + bindings.**

  - Plan decides how bytes are carved up.
  - Bindings decide how to _use_ them (seqlock protocol, type-safe views, APIs).

- **Zero allocations in the hot path.**

  - `allocateShared*` / `allocateWasmShared` / `mapViews` are setup-time only.
  - `params.within`, `meters.publish`, `meters.snapshot` never allocate backing or views.

- **Strong invariants, loud failures.**

  - Misaligned offsets, undersized buffers, and non-shared WASM memory are all treated as hard errors.
  - There is no silent "best effort" layout – the planner + backing pair must be correct.

If you're working on this layer, the goal is not to be clever; it's to be boring, predictable, and brutally clear about
where every byte lives. Everything above you depends on that.
