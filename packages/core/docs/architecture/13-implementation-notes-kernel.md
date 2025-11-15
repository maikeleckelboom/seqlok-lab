# Implementation Notes (Kernel)

Internal details for contributors and advanced users.
This document explains _how_ the kernel achieves its guarantees without imposing runtime overhead on hot paths.

---

## 1. Design principles

### Boring wire, not a framework

The core provides:

- spec → plan → backing → handoff → bindings
- seqlock-based synchronization
- typed controller/processor facades

It intentionally does **not** provide:

- reactivity / change-tracking
- schema migration or persistence
- scheduling, scenes, or orchestration

Those belong in higher layers (devices, drivers, apps).

### Fail-fast over fail-safe

When invariants are broken (mismatched layouts, wrong handoff, undersized backing, out-of-range writes), the library
throws a typed `SeqlokError`.

- No silent recovery
- No "best effort" remapping of incompatible layouts
- Clear error codes which can be logged, surfaced in UIs, or mapped to metrics

The cost is a synchronous throw at the boundary where the invariant is violated; the benefit is avoiding corruption in
long-lived processes.

### Zero-allocation hot paths

After `bindController` / `bindProcessor`:

- `processor.params.within`
- `processor.meters.publish`
- controller param writes (`params.set` / `params.update`)
- controller meter snapshots with `into` buffers

…are all implemented without heap allocations in the kernel. Any objects you create inside callbacks are your
responsibility.

Plain `controller.meters.snapshot()` **does** allocate result objects and typed arrays; it's expected to run off the RT
thread (UI, logging, etc.).

### Type safety with no runtime cost

Types encode:

- legal param/meter keys per spec
- scalar vs array shape
- enum label unions and value domains

Bindings precompute:

- byte offsets (`offsetBytes`)
- typed-array indices (`offsetBytes / BYTES_PER_ELEMENT`)
- function closures for scalar writes and reads

At runtime, a field access is a direct typed-array load/store behind a simple property read / function call. There are
no proxies or dynamic lookups on the hot path.

### Deterministic plan

Given the same spec:

```ts
const planA = planLayout(spec);
const planB = planLayout(spec);
```

…you must get the same layout: plane lengths, offsets, and hash.

This enables:

- reproducible debugging
- out-of-process tooling
- independent re-implementation in other languages that accept the same spec/plan format

---

## 2. Hash-verified handoffs

### Why

Prevent accidental spec/plan/backing mismatches across agents.

- The controller may be upgraded before a worker.
- Multiple workers may share similar but not identical specs.
- A bug in handoff wiring can easily connect the wrong backing to the wrong spec.

A layout-level hash + size checks provide a cheap compatibility guard.

### What is hashed

At minimum, the hash covers:

- spec identity (internal id/version)
- param/meter keys
- kinds (f32, i32, bool, enum, arrays)
- array lengths
- enum domains (labels in declaration order)

The exact algorithm is an internal 64-bit hash (exposed as `bigint`), not part of the public ABI. Only **equality** of
hashes matters.

### Where it lives

- `plan.hash` — the hash computed from the spec at planning time.
- `handoff.meta.hash` — the hash stored alongside plane lengths/metadata in the handoff envelope.

`plan.bytesTotal` and `handoff.meta.bytesTotal` are also compared as a coarse guard.

### Verification

On the processor side, the recommended pattern is:

```ts
const received = receiveHandoff(msg.handoff);
const proc = bindProcessor(spec, received);
```

`bindProcessor(spec, received)`:

1. Compares `plan.hash` against `received.meta.hash`.
2. Compares `plan.bytesTotal` against `received.meta.bytesTotal`.
3. Fails fast with a `handoff.invalidArtifact` error if they disagree.

This is the last line of defence against wiring the wrong backing into the wrong processor.

---

## 3. Seqlock mechanics (kernel level)

Seqlok uses a **dual-counter seqlock** per family (params, meters):

```text
LOCK: Int32
SEQ : Int32   // interpreted as u32 via >>> 0 when needed
```

- `LOCK` parity encodes writer activity:

  - even → quiescent
  - odd → writer active

- `SEQ` is a **commit stamp**, incremented exactly once per successful commit.

### Writer protocol (conceptual)

Writers are **single-writer by design** (SWMR). The implementation relies on that: no CAS in the steady state.

For a write epoch:

1. `LOCK += 1` (enter; becomes odd)
2. Write payload (scalars/arrays under this domain)
3. `LOCK += 1` (exit; becomes even)
4. `SEQ += 1` (commit fence)

The final `SEQ` bump is the visibility point: readers pair their second `SEQ` load with this store.

If the writer throws during step 2, the kernel guarantees:

- `LOCK` is returned to an even value
- `SEQ` is **not** bumped

This prevents lock poisoning.

### Reader protocol (via primitives)

Readers use `tryRead` / `acquire` from the seqlock primitives:

```ts
const { ok, value, status } = tryRead(pair, reader, options);
```

Where `status` is:

```ts
interface SpinStatus {
  readonly spins: number;
  readonly retries: number;
  readonly kind: 'ok' | 'writerActive' | 'budgetExhausted';
}
```

Behaviour:

1. Spin while `LOCK` is odd (bounded).
2. Capture `SEQ` → `s1`.
3. Invoke `reader()` to sample payload.
4. Capture `SEQ` → `s2`.
5. If `LOCK` even and `s1 === s2`:

- `ok: true`, `kind: 'ok'`.

6. If the writer **never quiesces** within the spin budget:

- `ok: false`, `kind: 'writerActive'`, `value` is a **degraded** sample (whatever `reader()` returned on the last
  attempt).

7. If the retry budget is exhausted:

- `kind: 'budgetExhausted'`, and the helper throws `SeqlokError<'primitives.seqlockTimeout'>`.

`acquire` wraps `tryRead` with a policy (`'fallback' | 'timeout'`) and is what bindings call.

### Memory ordering

JS Atomics are sequentially consistent at the language level. The rules we rely on:

- Writer:

  - payload writes → `Atomics.add` / `Atomics.store` on `SEQ`

- Reader:

  - `Atomics.load` on `SEQ` before payload reads
  - `Atomics.load` on `SEQ` after payload reads

This is sufficient to guarantee that, on a coherent read, the reader sees either the full **before** state or the full \*
\*after\*\* state, never a mixed set.

---

## 4. Binding implementation: `within`, `publish`, `snapshot`

This section connects the seqlock primitives to public bindings.

### `processor.params.within(cb)`

- Uses `acquire` over the **param** pair `(PU.LOCK, PU.SEQ)`.
- On each attempt:

  - Captures all scalar params into a compact struct.
  - Reuses pre-created aliasing views for array params.

- If `acquire` returns `kind: 'ok'`:

  - Invokes `cb(view)` with that struct and views.

- If `acquire` reports `'writerActive'`:

  - Retries until budgets are hit.

- If budgets are exhausted:

  - Throws `primitives.seqlockTimeout` with spin/retry counts.

Views are scoped to the callback:

- No allocations per call in the kernel.
- User code must treat views as ephemeral; reusing them outside `cb` is a contract violation.

### `processor.meters.publish(cb)`

- Uses the **meter** pair `(MU.LOCK, MU.SEQ)`.
- Wrapper around `publish(pair, writer)` from the primitives:

  - `LOCK` bumped odd → even
  - `SEQ` bumped once on successful completion

Scalar meters are exposed as writer functions: `m.peak(value)`.
Array meters use `stage`:

```ts
m.spectrum.stage((buf) => {
  buf.set(spectrum); // single commit
});
```

The internal invariant:

- Exactly **one** `SEQ` bump per `publish`.
- Errors inside `cb` unlock without bumping `SEQ`.

### `controller.meters.snapshot(...)`

Controller reads go through `acquire` on the **meter** pair `(MU.LOCK, MU.SEQ)`.

Three main usage forms:

```ts
// 1) Variadic strings
const peak = controller.meters.snapshot('peak');

// 2) Array of keys
const { peak, rms } = controller.meters.snapshot(['peak', 'rms']);

// 3) Object form + into buffers
const into = { spectrum: new Float32Array(1024) };
const { spectrum } = controller.meters.snapshot(['spectrum'], { into });
```

Implementation notes:

- All forms normalize into a set of meter keys and an optional `into` map.

- Scalars are copied into a plain object.

- Arrays:

  - Without `into`: new typed arrays are allocated and filled.
  - With `into`: user-provided buffers are **validated**:

    - type (constructor) must match
    - length must match planned length

  On mismatch, a typed `binding.snapshotIntoLengthMismatch` / `binding.shape` error is thrown.

- Returned arrays are **readonly at the type level**, but in the `into` case they alias the provided buffer so callers
  can reuse them.

`snapshot` calls `acquire` with a policy tuned for UI/monitoring:

- Normal path: timeout is extremely unlikely in normal workloads.
- When it happens, the error carries spin/retry counts and last observed SEQ.

---

## 5. Planes, offsets, and bindings

### Planner responsibilities

`planLayout(spec)` computes, for each key:

- `plane`: which plane holds the value (`PF32`, `PI32`, `PB`, `MF32`, `MF64`, `MU32`)
- `offsetBytes`: byte offset into that plane
- `length`: element count (arrays only)

And for each plane:

- `lengthBytes`: total bytes used across all fields
- `baseOffset`: where the plane starts inside the contiguous SAB (for the shared backing flavour)

It also assigns the control planes `PU` and `MU` and their seqlock slots.

### Binding construction

Bindings:

1. Map the plan + backing into concrete TypedArrays per plane.
2. Precompute index and length per key:

- `index = offsetBytes / BYTES_PER_ELEM[plane]`.

3. Build small inline helpers:

- controller param writers: `set`, `update`, `stage`
- processor param readers: struct field getters, aliasing array views
- processor meter writers: scalar writers + array `stage` callbacks
- controller meter readers: snapshot functions

There is no reflection or dynamic shape at runtime; everything flows from `plan`.

---

## 6. Value validation & range policy

### Controller → params

At the binding boundary, runtime validation enforces:

- **Key correctness** — TS already prevents invalid keys; runtime still checks shape/offset tables to avoid UB.
- **Type family correctness** — e.g. you can’t accidentally use a f32 param writer for an enum field.
- **Range policy** for numeric params:

  - `rangePolicy: 'clamp'` — values are clamped to `[min, max]`.
  - `rangePolicy: 'reject'` — out-of-range values throw `binding.paramRange`.

Arrays:

- Shape is validated (length must match planned).
- No per-element clamping; callers are expected to respect the numeric domain.

### Processor → meters

Meters are treated as **telemetry**:

- Scalar writers accept any finite `number` (subject to domain checks where relevant).
- Arrays must match shape; otherwise a shape error is thrown.
- Booleans are encoded as 0/1 in `MU32`.

Errors from this layer live under codes such as:

- `binding.invalidValue`
- `binding.paramRange`
- `binding.shape`
- `binding.snapshotIntoLengthMismatch`

---

## 7. Diagnostics & ergonomics hooks

### `version()` helpers

Both families expose a cheap version helper:

```ts
const pv = controller.params.version(); // param SEQ (PU.SEQ)
const mv = controller.meters.version(); // meter SEQ (MU.SEQ)
```

Each is a single atomic load, interpreted as `u32` with wraparound.
Typical pattern:

```ts
let last = controller.meters.version();

function frame() {
  const v = controller.meters.version();
  if (v !== last) {
    last = v;
    const meters = controller.meters.snapshot(['peak', 'rms']);
    drawMeters(meters);
  }
  requestAnimationFrame(frame);
}
```

### Error detail payloads

All `SeqlokError` instances carry structured `details`:

- For seqlock timeouts:

  - `spins`, `retries`, domain (`'params' | 'meters'`), where (`'params.within'`, `'meters.snapshot'`, …).

- For backing/plan issues:

  - expected vs actual byte lengths, planes, hashes.

- For binding issues:

  - key, expected shape/range, actual value.

This makes it easy to:

- dump meaningful logs
- surface targeted error messages in UIs
- build test assertions around specific failure modes

### Helpers & kits

Higher-level helpers (not part of the kernel) are encouraged to:

- close over `spec` and `plan` to avoid repetition in app code
- offer "device kits" with `createControllerKit(spec)` / `createProcessorKit(spec)` patterns
- stay thin: no extra concurrency or memory semantics beyond what the kernel already provides

---

## 8. Future toggles (non-contract v1)

These are implementation ideas, **not** part of the v1 public contract:

- Tunable spin/retry budgets for extreme workloads or platform quirks.
- Extended seqlock state `(SEQ, GEN)` for stricter anti-ABA guarantees if a future use case truly needs it.
- Optional richer status on public APIs (`snapshotWithStatus`, `withinWithStatus`) that surface `SpinStatus` directly.
- Dedicated boolean planes when/if runtimes expose atomic 8-bit operations with suitable semantics.

Any such feature must preserve the core invariants:

- deterministic plan
- single writer per family (SWMR)
- seqlock-based coherence
- zero-allocation hot paths

---

These notes are the glue between the high-level docs and the actual kernel: they describe how the guarantees are
implemented and where to look when changing behaviour.
