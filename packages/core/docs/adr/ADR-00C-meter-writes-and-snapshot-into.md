# ADR-00C: Meter Writes & Snapshot `into`

**Status:** Accepted
**Date:** 2025-11-12
**Revised:** 2026-05-09 (acknowledge `writer.set` as current convenience sugar)
**Scope:** `@seqlok/core` bindings — meter writing API and controller snapshots
**Decision Owners:** Binding/API maintainers

---

## 0) Summary

We finalize two user-visible binding decisions:

1. **Meter writes use per-key functions for the hot path, with `writer.set` as convenience sugar.**

- Scalars are written by value via **per-key writers** generated from the spec:

  - `writer.peak(1.25)` — preferred hot path

- Scalars may also be written via the convenience method:

  - `writer.set('peak', 1.25)` — dynamic-key sugar, slightly less performant

- Arrays are written via **explicit mutator callbacks**:

  - `writer.stage('spectrum', (dst) => { /* mutate */ })`

- There is **no `writer.set(key, valueOrMutator)` overload for arrays**. Arrays are stage-only.

2. **Controller snapshot keeps `into` as a nested option** (do **not** flatten).

- Arrays may be zero-copied into caller-supplied buffers via:

  - `snapshot(keys, { into: { arrayKey: buffer } })`
  - or `snapshot({ keys, into })` in object form.

These choices:

- keep meter writes maximally predictable and cheap in hot paths,
- preserve type precision for both fixed and projected snapshots,
- avoid runtime discrimination or dynamic dispatch on the core binding.

---

## 1) Rationale

### 1.1 Scalars by value; arrays by mutation

There are two fundamentally different data categories:

- **Scalars** – cheap numbers (`f32`, `f64`, `u32`) that are replaced atomically.
- **Arrays** – buffers that are mutated in place over many elements.

We codify this distinction:

- **Scalars by value**

  - Per-key functions give the best hot-path ergonomics and performance:

    - `writer.rms(value)`, `writer.peak(value)`, …

  - No closures, no shape checks, minimal runtime dispatch.
  - The TypeScript signature is straight-line and easily inlined.

  - For dynamic key selection, `writer.set(key, value)` exists as convenience sugar:

    ```ts
    const key: 'rms' | 'peak' = decideKey();
    writer.set(key, 0.5); // convenience for dynamic dispatch
    ```

  - Benchmarks show `writer.set` has ~equal or slightly more overhead than direct per-key calls.

- **Arrays by mutation**

  - Arrays are always written via `stage(key, fn(view))`:

    - The callback receives a **mutable view** into a backing plane.
    - The write is scoped: one coherent commit per `publish`, with a single MU bump.

  - This makes the seqlock contract explicit: "enter staging, mutate, commit once."

  - There is **no** `writer.set(key, valueOrMutator)` for arrays. Arrays are stage-only.

- **No lazy scalar setters**

  - We deliberately forbid lazy scalar forms like:

    ```ts
    // ❌ not allowed in core
    writer.peak(() => computePeak());
    ```

  - They are easy to misuse (forgetting to call, double-calling, etc.), and add nothing we cannot express with a local variable:

    ```ts
    const peak = computePeak();
    writer.peak(peak);
    ```

### 1.2 Keep `into` nested

For controller snapshots, we keep `into` as a nested options field:

- **Intent signalling**

  - `into` is an explicit "destination map":

    ```ts
    controller.meters.snapshot(["spectrum"], {
      into: { spectrum: scratchSpectrum },
    });
    ```

  - This makes it obvious which fields are zero-copy / reuse vs which are allocated fresh.

- **Future-proof shape**

  - A nested `into` allows adding other options (`format`, `normalize`, `precision`, …) without colliding with meter keys.
  - Options remain structurally separated from the data.

- **Simple types & implementation**

  - Callers either:

    - accept brand-new arrays (no `into`), or
    - pass a partial `into` object where they care about allocations.

  - Implementation remains straightforward: a single `{ into?: Record<string, TypedArray> }` branch, no flattened overloads.

---

## 2) Canonical API (high-level)

### 2.1 Processor — meter writers

The processor is the **sole writer** for meters. The canonical entry point is:

```ts
// conceptual shape, not exact implementation
export interface ProcessorMetersWriter<S> {
  // Per-key scalar writers (generated from the spec)
  // Example:
  rms(value: number): void;
  peak(value: number): void;

  // Dynamic scalar setter (convenience sugar)
  set<K extends ScalarMeterKeys<S>>(key: K, value: MeterScalarFor<S, K>): void;

  // Array writer: RAII-style staging
  stage<const K extends ArrayMeterKeys<S>>(
    key: K,
    fn: (view: MutableMeterArrayView<S, K>) => void,
  ): void;
}

export interface ProcessorMetersBinding<S> {
  publish(fn: (writer: ProcessorMetersWriter<S>) => void): void;
}
```

**Invariants:**

- **Exactly one MU bump per call** to `publish`:

  - The binding handles `MU.LOCK` / `MU.SEQ` dance around the entire `fn(writer)` call.
  - All scalar writes and array mutations in that call are part of one coherent meter frame.

- **Scalar writes:**

  - Preferred: per-key methods for the hot path:

    - `writer.rms(value)`
    - `writer.peak(value)`

  - Convenience: dynamic dispatch via `writer.set(key, value)`.

  - No callback form, no lazy evaluation.

- **Array writes:**

  - Always via `writer.stage(key, fn(view))`.
  - The `view` is a **scratch alias** into the meter plane; callers must not retain it outside the call.
  - The stage function may be called multiple times inside one `publish`, but there is still only one commit.

**Usage pattern (with params):**

```ts
processor.params.within((p) => {
  const ratio = p.timeRatio;
  const coeffs = p.coeffs; // aliasing view into PF32/PI32

  const { peak, rms, spectrum } = this.dsp.process(input, ratio, coeffs);

  processor.meters.publish((w) => {
    w.peak(peak);
    w.rms(rms);

    w.stage("spectrum", (dst) => {
      dst.set(spectrum);
    });
  });
});
```

Within a single `publish` call:

- all scalar and array writes are causally linked to a **single coherent param snapshot** (from `params.within`),
- observers and controller snapshots that see the resulting MU bump treat it as **one meter frame**.

### 2.2 Controller — meter snapshots (with `into`)

Controller-side meter reads:

- `controller.meters.snapshot()` — full snapshot
- `controller.meters.snapshot(keys, options?)` — projection snapshot
- `controller.meters.snapshot(options)` — object form (`{ keys?, into? }`)
- `options.into` — buffer map for zero-alloc array meters

Conceptual shape:

```ts
export interface ControllerMetersBinding<S> {
  snapshot(): MetersSnapshot<S>;

  snapshot<const K extends readonly MeterKeys<S>[]>(
    keys: K,
    options?: {
      readonly into?: Partial<MetersArrayBuffers<S, K>>;
    },
  ): MetersSnapshotTuple<S, K>;

  snapshot<const K extends readonly MeterKeys<S>[]>(options: {
    readonly keys: K;
    readonly into?: Partial<MetersArrayBuffers<S, K>>;
  }): MetersSnapshotTuple<S, K>;
}
```

**Examples:**

```ts
// Full snapshot: convenient, maximal work
const all = controller.meters.snapshot();

// Selected keys, new arrays allocated
const [rms, spectrum] = controller.meters.snapshot(["rms", "spectrum"]);

// Selected keys, reusing caller buffers for arrays
const scratch = { spectrum: new Float32Array(1024) };

const [peak, spectrumView] = controller.meters.snapshot(["peak", "spectrum"], {
  into: { spectrum: scratch.spectrum },
});

// Object form (e.g. for TIER 0 "zero-alloc" usage)
const { rms: rms2 } = controller.meters.snapshot({
  keys: ["rms"] as const,
  into: {},
});
```

Semantics:

- Snapshots are **logically copies** from the controller's POV:

  - Even if the implementation reuses internal scratch arrays when no `into` is supplied,
    the caller treats the returned structure as detached from SAB (suitable for persistence / hydrate).

- When `into` is provided:

  - For matching array meters, we write into the provided buffers **in place**.
  - For scalars or missing entries in `into`, we allocate as usual or return plain numbers.

- Combined with seqlock (see other docs), snapshots are **coherent per call**:

  - each invocation corresponds to a single meter frame.

---

## 3) Snapshot tiers (controller meters)

We use "tiers" to describe **work levels**, not new APIs:

```text
Controller meter snapshot usage tiers
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│     TIER 0       │     TIER 1       │     TIER 2       │     TIER 3       │
│   Zero-alloc     │  Single-key      │   Selected keys  │   Full snapshot  │
├──────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ .snapshot({      │ .snapshot(       │ .snapshot(       │ .snapshot()      │
│   into: {        │   ['rms']        │   ['rms',        │                  │
│     spectrum:    │ )                │    'spectrum'],  │                  │
│       buf        │                  │   { into: bufs } │                  │
│   },             │                  │ )                │                  │
│ })               │                  │                  │                  │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

Notes:

- Mirrors the `meters.snapshot` API:

  - optional keys array,
  - optional `{ into }` object for zero-alloc snapshots.

- Purely about **bandwidth vs convenience**:

  - TIER 0: zero alloc, fixed buffers, minimal copying.
  - TIER 3: convenient but max bandwidth.

---

## 4) Consequences

### 4.1 Positive

- **Hot path stays minimal and explicit**

  - `meters.publish(cb)` + per-key writers is easy to inline and reason about.
  - No extra polymorphism in the core binding.

- **Clear semantics per data category**

  - Scalars → value.
  - Arrays → `stage` mutator.
  - This maps directly onto TypedArray + seqlock behavior.

- **Controller snapshots are expressive without being magical**

  - Single entry point (`snapshot`) covers:

    - full snapshots,
    - projections,
    - zero-alloc patterns via `into`.

  - Type inference remains strong and predictable.

- **Room for higher-level libraries**

  - Product code and host-level integration can add:

    - dynamic writers (`setDynamic(writer, key, value)`),
    - preset serializers built on `snapshot`/`hydrate`,
    - observer-grade visualizers with their own policies.

### 4.2 Trade-offs / negatives

- Dynamic meter selection across scalar and array keys requires explicit branching:

  - `writer.set(key, value)` covers scalars; array writes always use `stage`, so code that handles both must branch explicitly.
  - This is deliberate: the kernel stays minimal; products that truly need fully dynamic dispatch can pay for it explicitly.

- Controller snapshot options are slightly more verbose than a "flattened" signature:

  - `{ into: { spectrum } }` instead of extra positional parameters.
  - We accept this for better extensibility and clearer types.

---

## 5) Alternatives (rejected)

### 5.1 Keep `writer.set(key, valueOrMutator)` in core

**Accepted for scalars only; arrays remain stage-only.**

- Scalar `writer.set(key, value)` exists as convenience sugar:

  - Pros:
    - Useful for dynamic key selection (loops, tables, generic instrumentation).
    - Simplifies code that receives a key name at runtime.

  - Cons:
    - Slightly more overhead than per-key methods (benchmarked).
    - Requires runtime key dispatch.

  - Resolution: provided as convenience, but per-key methods remain the preferred hot path.

- Array `writer.set(key, valueOrMutator)`:

  - **Rejected.** Arrays are stage-only via `writer.stage(key, fn(view))`.
  - No runtime discrimination between scalars and arrays within `set`.
  - Keeps the scalar vs array distinction explicit.

### 5.2 Flatten `into` into top-level snapshot parameters

Example of the rejected shape:

```ts
controller.meters.snapshot(["rms", "spectrum"], spectrumBuffer /* into */, {
  normalize: true,
});
```

Issues:

- Parameter order becomes brittle as we add more options.
- Type signatures grow unwieldy for little gain.
- It's harder to visually distinguish **destination buffers** from other options.

Decision: keep `into` nested; if we grow more options, they remain structurally isolated from meter names and destination buffers.

---

This ADR is the normative source for:

- the presence and shape of `processor.meters.publish(cb)` and its writer surface, and
- the controller's `meters.snapshot(..., { into })` behavior and overloads.

If future releases add richer observer policies or new convenience helpers, they should **build on** these decisions rather than redefine them.
