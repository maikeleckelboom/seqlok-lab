# Seqlok Memory Plane Architecture

> **Core invariant:** If data is *allowed to be late*, it belongs as a **meter**. If it must be visible *this block*,
> it’s a **param**. This prevents param planes from becoming a shadow telemetry system.

---

## Definitions

| Term                  | Meaning                                                                           |
|-----------------------|-----------------------------------------------------------------------------------|
| **Plane**             | A contiguous backing region + canonical TypedArray view (`PF32`, `PI32`, `PB`, …) |
| **Kind**              | A DSL-level type string (`u32.array`, `enum`, `f32`, …)                           |
| **Enabled**           | Present in the **kind catalog** and accepted by planner + bindings end-to-end     |
| **Spec-defined**      | Allowed by type unions / builders, but rejected by planner if not in catalog      |
| **Block**             | One render quantum (engine-controlled; typically 128 frames, but not guaranteed)  |
| **Latency tolerance** | Max delay before behavior/UI becomes *incorrect* (not just annoying)              |

---

## Source of Truth

| Layer              | Location                                   | What it gates                                                                        |
|--------------------|--------------------------------------------|--------------------------------------------------------------------------------------|
| Spec-defined kinds | `spec/types`                               | Type unions / builders accept the kind                                               |
| Enabled kinds      | Kind catalog                               | Planner accepts the kind                                                             |
| Planner gate       | Catalog hit + plane gate                   | Layout computed + slot kind metadata emitted                                         |
| Plan contract      | `plan/*` emitted layout                    | **Plans MUST include `EntrySlot.kind`** so bindings can interpret bytes without defs |
| Bindings contract  | TypedArray view + snapshot/zero-copy rules | Runtime access works                                                                 |

---

## Hard Guarantees

* **Zero-copy is the default** for array kinds (snapshots reuse identity) unless explicitly stated otherwise.
* **Reinterpret beats conversion** whenever byte-compatible (`u32` over `PI32`, `i32`/`enum` over `MU32`, etc.).
* **Plans emitted by current versions MUST include `EntrySlot.kind`** for every slot. (The type can remain optional only
  for legacy plan decode.)
* **Bool canonicalization:** writers MUST write `0`/`1`. Readers MAY treat nonzero as true, but debug builds should flag
  non-canonical values.
* **Regression tests** must enforce these guarantees (zero-copy identity, reinterpret views, bool canonicalization).

---

## Latency Tolerance Reference

| Visibility Requirement | Tolerance   | Typical Use                                  | Group  |
|------------------------|-------------|----------------------------------------------|--------|
| **Immediate**          | 0 blocks    | Transport flags, mode switches, input states | Params |
| **Next block OK**      | 0–1 blocks  | Most params, UI-rate controls                | Params |
| **UI-acceptable**      | 1–4 blocks  | Fast meters (RMS, peaks, confidence)         | Meters |
| **Analysis-grade**     | 2–8+ blocks | Heavy analysis, counters, histograms         | Meters |

> ⚠️ **Control-loop meters:** If a meter feeds back into DSP behavior (side-chain gating, adaptive thresholds), treat it
> like a param **or** explicitly document the allowed delay and stability requirements. Otherwise you get pumping
> artifacts.

---

## Plane Map

> `PU` and `MU` are **mechanism planes** (seqlock headers + padding). They never appear as user-addressable kinds.
> **Interpretation is a view:** signedness and enum-ness are *views* over a 32-bit backing.

| Group  | Plane  | Backing View   | Writer (typical)  | Reader (typical)       | Purpose                                                                             |
|--------|--------|----------------|-------------------|------------------------|-------------------------------------------------------------------------------------|
| Params | `PU`   | `Uint32Array`  | control thread(s) | audio thread           | Seqlock headers + padding                                                           |
| Params | `PF32` | `Float32Array` | control thread(s) | audio thread           | Float param storage                                                                 |
| Params | `PI32` | `Int32Array`   | control thread(s) | audio thread           | 32-bit int storage (incl. `u32`, `enum` via view)                                   |
| Params | `PB`   | `Uint8Array`   | control thread(s) | audio thread           | Byte storage (`bool`, `u8`; `i8.array` via `Int8Array` view)                        |
| Meters | `MU`   | `Uint32Array`  | audio thread      | control/UI/diagnostics | Seqlock headers + padding                                                           |
| Meters | `MF32` | `Float32Array` | audio thread      | control/UI/diagnostics | Float meter storage                                                                 |
| Meters | `MF64` | `Float64Array` | audio thread      | control/UI/diagnostics | Double meter storage                                                                |
| Meters | `MU32` | `Uint32Array`  | audio thread      | control/UI/diagnostics | 32-bit int meter storage (`u32`/`bool`/`i32`/`enum` via view; `bool` stored as 0/1) |

---

## Param Kinds (14 total)

Grouped by plane for scanability.

### `PF32` kinds

| Kind        | Status | JS View        | Payload     | Cadence             | Latency | Examples                                                              |
|-------------|--------|----------------|-------------|---------------------|---------|-----------------------------------------------------------------------|
| `f32`       | ✅      | `Float32Array` | 1 float     | UI-rate / per block | 0–1     | `filterCutoffHz`, `deckGain`, `crossfaderPos`, `stretchRatio`         |
| `f32.array` | ✅      | `Float32Array` | 2–32 floats | UI-rate / per block | 0–1     | 3-band EQ `[low,mid,high]`, multichannel gains, compressor thresholds |

### `PI32` kinds

> **Reinterpret rule:** `u32` and `u32.array` **must** be exposed as `Uint32Array` views over `PI32` bytes (no copies).

| Kind         | Status | JS View        | Payload      | Cadence      | Latency | Examples                                                          |
|--------------|--------|----------------|--------------|--------------|---------|-------------------------------------------------------------------|
| `i32`        | ✅      | `Int32Array`   | 1 int        | on change    | 0       | `selectedEffectSlot`, `activeDeckIndex`, `loopLengthBeatsIndex`   |
| `u32`        | ✅      | `Uint32Array`¹ | 1 u32        | event-driven | 0–1     | `enabledFeaturesMask`, `midiLearnHash`, stable IDs                |
| `enum`       | ✅      | `Int32Array`²  | 1 index      | on change    | 0       | `syncMode={off,tempo,phase}`, `stretchQuality={eco,balanced,pro}` |
| `i32.array`  | ✅      | `Int32Array`   | 8–256 ints   | bursty       | 0–1     | Routing table indices, per-pad mapping                            |
| `u32.array`  | ✅      | `Uint32Array`¹ | 16–256 u32   | bursty       | 0–1     | 64-step sequencer packed `(noteId\|accent\|gate)`                 |
| `enum.array` | ✅      | `Int32Array`²  | 2–64 indices | bursty       | 0–1     | Per-band filter type, per-deck modes, per-lane role               |

¹ Reinterpret view over `PI32` bytes (no copy)
² Stored as indices in `Int32Array`; valid domain is `0..N-1`; labels resolved at values-table level

### `PB` kinds

> **View rule:** `i8.array` **must** be exposed as an `Int8Array` view over `PB` bytes (no copies). This is signed vs
> unsigned interpretation, not bit reinterpretation.

| Kind         | Status | JS View            | Payload      | Cadence               | Latency | Examples                                                   |
|--------------|--------|--------------------|--------------|-----------------------|---------|------------------------------------------------------------|
| `bool`       | ✅      | `Uint8Array` (0/1) | 1 flag       | frequent              | 0       | `syncEnabled`, `keyLockEnabled`, `bypassFX`, `recordArmed` |
| `bool.array` | ✅      | `Uint8Array` (0/1) | 8–256 flags  | frequent              | 0       | 16-pad pressed states, per-lane toggles, per-band bypass   |
| `u8.array`   | ✅      | `Uint8Array`       | 16–512 bytes | bursty / per UI frame | 0–1     | 128-step velocity, per-LED brightness, per-pad aftertouch  |
| `i8.array`   | ✅      | `Int8Array`¹       | 16–512 i8    | bursty                | 0–1     | Per-step swing offsets                                     |

¹ Signed view over `PB` bytes (no copy)

### Awaiting plane implementation

| Kind        | Status | JS View       | Payload     | Cadence      | Latency | Notes                                                               |
|-------------|--------|---------------|-------------|--------------|---------|---------------------------------------------------------------------|
| `i16.array` | ⏳      | `Int16Array`  | 64–2048 i16 | per N blocks | 1–4     | Awaits `P16` (see [Decided: 16-bit Planes](#decided-16-bit-planes)) |
| `u16.array` | ⏳      | `Uint16Array` | 64–2048 u16 | per N blocks | 1–4     | Awaits `P16` (see [Decided: 16-bit Planes](#decided-16-bit-planes)) |

---

## Meter Kinds (16 total)

Grouped by plane for scanability.

### `MF32` kinds

| Kind        | Status | JS View        | Payload       | Cadence           | Latency | Examples                                        |
|-------------|--------|----------------|---------------|-------------------|---------|-------------------------------------------------|
| `f32`       | ✅      | `Float32Array` | 1 float       | per block         | 1–4     | Current RMS, BPM confidence, phase error        |
| `f32.array` | ✅      | `Float32Array` | 8–1024 floats | per block / per N | 2–8     | FFT bands, per-channel peaks, per-stem loudness |

### `MF64` kinds

| Kind        | Status | JS View        | Payload       | Cadence            | Latency | Examples                                        |
|-------------|--------|----------------|---------------|--------------------|---------|-------------------------------------------------|
| `f64`       | ✅      | `Float64Array` | 1 double      | per block / slower | 2–8     | Master clock phase accumulator, drift estimator |
| `f64.array` | ✅      | `Float64Array` | 1–256 doubles | per N blocks       | 4–32    | Offline analysis traces, regression-grade refs  |

### `MU32` kinds (32-bit int storage)

> **Rule:** `MU32` storage is 32-bit; expose `u32`/`u32.array`/`bool`/`bool.array` as `Uint32Array` and `i32`/`enum`/
`i32.array`/`enum.array` as `Int32Array` **views over the same bytes** (no copies).

| Kind         | Status | JS View             | Payload        | Cadence           | Latency | Examples                                       |
|--------------|--------|---------------------|----------------|-------------------|---------|------------------------------------------------|
| `u32`        | ✅      | `Uint32Array`       | 1 counter      | per block / event | 1–8     | `framesProcessed`, `xruns`, `beatCount`        |
| `bool`       | ✅      | `Uint32Array` (0/1) | 1 flag         | per block         | 1–4     | `isClipping`, `isOverloaded`, `isBeatDetected` |
| `i32`        | ✅      | `Int32Array`¹       | 1 signed       | per block         | 1–4     | Phase error ticks, signed deltas               |
| `enum`       | ✅      | `Int32Array`²       | 1 state        | on change         | 4–64    | Analysis state `{idle,warmup,locked}`          |
| `u32.array`  | ✅      | `Uint32Array`       | 4–128 counters | per block / event | 4–64    | Per-lane beat hits, histogram buckets          |
| `bool.array` | ✅      | `Uint32Array` (0/1) | 2–64 flags     | per block         | 1–8     | Per-channel clip flags, per-band gate-open     |
| `i32.array`  | ✅      | `Int32Array`¹       | 4–256 signed   | per block / per N | 2–8     | Per-band phase errors                          |
| `enum.array` | ✅      | `Int32Array`²       | 2–64 states    | on change         | 4–64    | Per-lane status states                         |

¹ Signed view over `MU32` bytes (no copy)
² Stored as indices in `Int32Array`; valid domain is `0..N-1`; labels resolved at values-table level

### Awaiting plane implementation

| Kind        | Status | JS View       | Payload       | Cadence      | Latency | Notes                                                                        |
|-------------|--------|---------------|---------------|--------------|---------|------------------------------------------------------------------------------|
| `u8.array`  | ⏳      | `Uint8Array`  | 64–2048 bytes | per N blocks | 8–128   | Awaits `M8` (see [Decided: 8-bit Meter Arrays](#decided-8-bit-meter-arrays)) |
| `i8.array`  | ⏳      | `Int8Array`   | 64–2048 i8    | per N blocks | 8–128   | Awaits `M8` (see [Decided: 8-bit Meter Arrays](#decided-8-bit-meter-arrays)) |
| `i16.array` | ⏳      | `Int16Array`  | 256–8192 i16  | per N blocks | 16–256  | Awaits `M16` (see [Decided: 16-bit Planes](#decided-16-bit-planes))          |
| `u16.array` | ⏳      | `Uint16Array` | 256–8192 u16  | per N blocks | 16–256  | Awaits `M16` (see [Decided: 16-bit Planes](#decided-16-bit-planes))          |

---

## Decision Flowchart

```
Is it control data or observation data?
├─ Control (affects DSP) ──────────────────────────► PARAM
│   ├─ Must be visible this block? (transport, mode) → 0-block tolerance
│   └─ UI-rate control? ──────────────────────────── → 0–1 block tolerance
│
└─ Observation (read-only from DSP) ───────────────► METER
    ├─ Feedback for control loop? ────────────────── → 0–1 blocks (MF32) ⚠️
    ├─ UI display (RMS, peaks)? ──────────────────── → 1–4 blocks (MF32)
    ├─ High-precision accumulator? ───────────────── → 2–8 blocks (MF64)
    └─ Counters, histograms, heavy analysis? ─────── → 4–64+ blocks (MU32)

⚠️ = Document delay/stability requirements if meter drives DSP
```

---

## Common Footguns

* **`enum` stores indices, not labels.** Label resolution happens at the values-table level. Valid domain is `0..N-1`.
* **`bool` param is `u8`; `bool` meter is `u32`.** Don’t mix views or assume same backing.
* **Meter driving DSP?** Document allowed delay + stability, or promote to param.
* **Bool canonicalization:** writers MUST write `0`/`1`; nonzero reads as true but is corruption (debug should
  complain).
* **MU32 is a 32-bit int plane:** `u32` vs `i32` vs `enum` is a *view* choice, not a storage choice.

---

## Decided: 16-bit Planes

**Decision:** **A) New planes.**

Implement **`M16` first** (meters), because large 16-bit buffers are typically analysis/telemetry and can tolerate
delay.

Add **`P16` later** only if a real latency-sensitive *control* use-case requires it.

Until `M16`/`P16` ship, use `i32.array`/`u32.array` (or `f32.array`) as the fallback.

### Planned Planes

| Plane | Status     | Purpose                                                  |
|-------|------------|----------------------------------------------------------|
| `M16` | ⏳ planned  | 16-bit meter arrays (`i16.array`, `u16.array`)           |
| `P16` | ⏳ deferred | 16-bit param arrays (only if justified by real use-case) |

---

## Decided: 8-bit Meter Arrays

**Decision:** TBD (leaning toward `M8` if histograms become common; otherwise pack into `MU32` with bitpacking).

| Option                                  | Pros                                                   | Cons                            |
|-----------------------------------------|--------------------------------------------------------|---------------------------------|
| **A) New plane** (`M8`)                 | Clean alignment, native `Uint8Array`/`Int8Array` views | Yet another plane               |
| **B) Pack into `MU32`** with bitpacking | No new planes                                          | Access complexity, slower reads |

Until decided, use `u32.array` for histogram-style data (wastes 3× memory but works).

---

## Enabling a New Kind (Checklist)

When enabling a kind (e.g., `u8.array` meters):

1. **Catalog:** Add to kind catalog (planner will now accept it)
2. **Bindings:** Ensure bindings create the correct JS view (TypedArray + reinterpret rules)
3. **Tests:** Add/adjust tests for identity/zero-copy behavior where relevant
4. **Docs:** Update this file:

* Flip status ⏳ → ✅
* Move row to appropriate plane section
* Fill in **Plane** and **JS View** columns

---

## Appendix: Plane Purpose (Narrative)

### `PU` — Param Seqlock Plane

Sample-accurate, lock-free parameter reads inside the audio thread. The processor reads a coherent snapshot of all
params for a render quantum without tearing while control thread writes.

### `PF32` — Param Float Data

Continuous musical controls: `deckA.playbackRate` (0.5–2.0), `filter.cutoffHz`, `reverb.mix`, `crossfadeCurve`,
`timeStretchRatio`.

### `PI32` — Param Int32 Data

Discrete controls and indices that must be atomic and cheap: `quantizeDivisionIndex`, `timeStretchQualityIndex`,
`syncMode` enum index, `cuePointIndex`, `activeDeck`, `beatgridVersion`.

### `PB` — Param Byte Data

Dense tiny flags and small byte arrays with minimal memory: `isPlaying`/`isSyncEnabled` booleans, or `u8.array` for
per-step data like a 64-step pattern velocity map.

### `MU` — Meter Seqlock Plane

Tear-free meter reads (control/UI/diagnostics reading meters while audio thread writes). Readers get coherent values of
peak/RMS/VU arrays and statuses.

### `MF32` — Meter Float32 Data

Fast meters where float32 is sufficient: per-channel RMS/peak, spectral band energies, beat-confidence, novelty curve
values.

### `MF64` — Meter Float64 Data

High-dynamic-range or high-precision analysis benefiting from double precision: long-running phase/clock accumulators,
extremely low-level measurement, offline analysis stats, regression-grade “golden” metrics.

### `MU32` — Meter 32-bit Int Data

32-bit integer meters: counters, bitmasks, signed values, discrete states. Signedness (`u32` vs `i32`) and enum-ness are
views over the same 32-bit storage. `bool` meters stored as `0`/`1`.
