# Seqlok Hotswap Lifecycle Specification

> **Version:** 0.1.0-draft  
> **Status:** Design Document  
> **Scope:** Generic engine lifecycle protocol for glitch-free configuration changes

## Overview

The Seqlok Hotswap Protocol defines a generic, reusable lifecycle for swapping DSP engine instances without audible glitches. It is designed to be algorithm-agnostic—whether the underlying engine is Signalsmith-stretch, Bungee, Bungee Pro, a simple varispeed resampler, or any future DSP implementation, the same protocol governs how configuration changes are applied.

> **Note on algorithm names:** The algorithm names used throughout this document (Signalsmith, Bungee, Bungee Pro, etc.) are illustrative. The initial Seqlok implementation focuses on Signalsmith-based engines (varispeed + stretch); other algorithms are examples of how the ABI generalizes to future adapters.

### Core Invariant

> **No live `configure()` on the active engine.**

Any configuration change that would cause transients, require re-initialization, or alter the internal processing kernel must go through the hotswap lifecycle rather than mutating the active engine in place.

## Design Philosophy

### Why Hotswap Instead of Live Configuration?

Traditional DSP engines often expose a `configure()` or `setParameter()` method that can be called at any time. This creates several problems in real-time audio:

1. **Transients and glitches** when internal state is invalidated
2. **Unbounded latency** if the engine must reallocate or recompute
3. **Race conditions** between the audio thread reading state and the control thread writing it
4. **Undefined behavior** during the transition period

The hotswap approach sidesteps all of these by treating configuration changes as *instance replacements* rather than *mutations*.

### The Mental Model

Think of engines as immutable configuration snapshots that process audio. When you need a different configuration, you don't modify the running engine—you spin up a new one alongside it, blend between them, then retire the old one.

This is analogous to how modern web servers handle deployments: blue-green deployment, not in-place mutation.

## Lifecycle Phases

The hotswap protocol consists of five phases:

```
spawn → prime → preWarm → crossFade → retire
```

> **Naming convention:** The phase names above are canonical. In code, string literals may be lowercased (`'prewarm'`, `'crossfade'`); the documentation uses mixed case (`preWarm`, `crossFade`) for readability. The semantics are identical.

### 1. Spawn

Create a new engine instance with the desired configuration. The engine is constructed but not yet ready to process audio.

**Requirements:**
- Must not block the audio thread
- May allocate memory, initialize FFT tables, etc.
- The new engine exists but is "cold"

### 2. Prime

Provide the new engine with context it needs to produce seamless output from its first sample. This typically includes:

- Current playback position
- Recent input history (for algorithms that need look-back)
- Phase information from the outgoing engine (if applicable)
- Any other state needed for sample-accurate alignment

**Requirements:**
- Must provide enough context for the engine to "catch up" to the current position
- Should be idempotent (calling prime multiple times produces the same result)

### 3. PreWarm

Run the new engine in parallel with the active engine, discarding its output. This ensures:

- Internal buffers are filled
- Any lazy initialization is complete
- The engine is producing stable, predictable output

**Requirements:**
- The engine processes real input data
- Output is discarded (not mixed to main output)
- Duration is algorithm-dependent (typically one or more processing blocks)

### 4. CrossFade

Both engines run in parallel, with their outputs blended over a configurable duration:

```
output = (1 - t) * oldEngine.output + t * newEngine.output
```

where `t` ramps from 0 to 1 over the fade duration.

**Requirements:**
- Both engines must process the same input simultaneously
- Fade duration should be musically meaningful (e.g., aligned to beats/bars)
- Fade curve may be linear, equal-power, or custom

**Responsibility split:**

| Concern | Owner |
|---------|-------|
| When to start swap | Driver |
| Fade shape and duration | Driver |
| Allocating / destroying engines | Driver |
| Blending the two output streams | Driver |
| Producing stable, predictable output | Engine |
| Being safe for parallel running | Engine |
| Reporting accurate latency | Engine |

> **Important:** Engines should **not** attempt to "help" by ducking, pre-fading, or otherwise compensating for the crossfade. The host owns blending entirely. Engines just produce their normal output; anything else causes double-fading artifacts.

### 5. Retire

The old engine is decommissioned:

- Stop calling `process()` on it
- Clean up resources
- Destroy the instance

**Requirements:**
- Must not block the audio thread
- Resource cleanup may be deferred to a background thread

## Engine ABI

Engines are black boxes that implement the `EngineABI` interface. This is the canonical contract—all engine implementations, regardless of language, must satisfy this shape:

```typescript
/**
 * EngineABI - The canonical engine interface.
 * 
 * In TypeScript implementations, this is typically exposed as a
 * class or object. The C/C++ equivalent uses function pointers.
 */
interface EngineABI<TConfig, THandle> {
  /**
   * Construct a new engine instance with the given immutable configuration.
   * May allocate, may be slow. Called off the audio thread.
   */
  create(config: TConfig): THandle;

  /**
   * Provide context for seamless startup.
   * Called before the engine enters the audio path.
   */
  prime(handle: THandle, ctx: PrimeContext): void;

  /**
   * Process one block of audio.
   * Must be real-time safe: no allocation, no blocking, bounded execution time.
   */
  process(
    handle: THandle,
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number
  ): void;

  /**
   * Release all resources associated with this engine instance.
   * May be called from a background thread after the engine is retired.
   */
  destroy(handle: THandle): void;
}
```

### PrimeContext

The prime context provides everything a new engine needs to produce output that aligns with the outgoing engine. It is strictly about **engine state alignment**—scheduling information (when to start the crossfade, fade duration, etc.) is managed separately by the driver and is not part of this contract.

```typescript
interface PrimeContext {
  /** Current playback position in samples */
  positionSamples: number;

  /** Current playback position in seconds */
  positionSeconds: number;

  /** Recent input history for look-back algorithms */
  inputHistory: readonly Float32Array[];

  /** Number of valid samples in inputHistory */
  historyLength: number;

  /** Phase state from outgoing engine (algorithm-specific, opaque) */
  phaseState?: unknown;
}
```

> **Note:** Crossfade scheduling (start sample, duration, curve) is owned by the `SwapSchedule` structure in the driver layer. Engines never see scheduling details—they only receive alignment context.

### Latency Reporting

Engines must report their algorithmic latency so the driver can compensate during playback and crossfades:

```typescript
interface EngineABI<TConfig, THandle> {
  // ... other methods ...
  
  /**
   * Return the engine's input-to-output latency in samples.
   */
  getLatency(handle: THandle): number;
}
```

> **Latency semantics:**
> - Latency is reported as **non-negative input-to-output delay** in samples.
> - Latency is measured at the **current configuration**—if quality tier affects latency, report the latency for the active tier.
> - The driver uses this value to align playback timing and to schedule crossfades correctly when swapping between engines with different latencies.

## Parameter Classification

Not all parameter changes require a hotswap. Parameters are classified as either **structural** or **non-structural**:

### Structural Parameters (Require Hotswap)

Changes that invalidate internal state, require reallocation, or would cause transients:

- Algorithm selection (e.g., Signalsmith → Bungee)
- Quality tier (eco / normal / insane)
- FFT size, window length, hop size
- Sample rate
- Channel count
- Transient detection mode
- Formant preservation mode

**Rule of thumb:** If the underlying library recommends "rebuild / reinit for this change," it's structural.

### Non-Structural Parameters (Live Update)

Changes that can be applied smoothly without reinitialization:

- Stretch ratio
- Pitch ratio
- Gain / volume
- Small psychoacoustic tweaks the library handles smoothly

These can be updated via a separate parameter channel without triggering the hotswap lifecycle.

## Scheduling

Hotswaps can be scheduled musically:

- **Immediate:** Begin the swap as soon as the new engine is primed
- **Beat-aligned:** Begin crossfade on the next beat boundary
- **Bar-aligned:** Begin crossfade on the next bar boundary
- **Sample-accurate:** Begin crossfade at a specific sample position

The CompositeDriver maintains scheduling state and coordinates with the transport system.

### SwapSchedule

The driver uses a `SwapSchedule` structure to control crossfade timing. This is **driver-only**—engines never see it; they only receive `PrimeContext` for alignment.

```typescript
interface SwapSchedule {
  /** Absolute start sample of the crossfade (global timeline) */
  startSample: number;

  /** Fade duration in samples */
  durationSamples: number;

  /** Fade curve identifier */
  curve: 'linear' | 'equalPower';

  /** Optional musical annotation for debugging (e.g., "bar 65") */
  label?: string;
}
```

**Separation of concerns:**

| Structure | Owner | Purpose |
|-----------|-------|---------|
| `SwapSchedule` | Driver | When and how to crossfade |
| `PrimeContext` | Engine | Where to align internal state |

The driver translates `SwapSchedule` into timing decisions; engines just receive `PrimeContext` and produce audio.

## Concurrency Model

The hotswap protocol assumes:

1. **Single Writer (Control Thread):** Initiates swaps, creates new engines, schedules crossfades
2. **Single Reader (Audio Thread):** Calls `process()` on active engine(s), performs crossfades

Communication between threads uses the SWSR (Single-Writer Single-Reader) command ring defined elsewhere in Seqlok.

### Thread Safety Guarantees

- `create()` and `destroy()` are called off the audio thread
- `prime()` is called off the audio thread, before the engine enters the audio path
- `process()` is called only from the audio thread
- During crossfade, both engines' `process()` methods are called from the audio thread

## Failure Model

Failures can occur at each lifecycle phase. The handling strategy depends on the phase and failure type:

### Phase-Specific Failures

| Phase | Failure Type | Handling |
|-------|--------------|----------|
| **spawn/create** | Allocation failure, invalid config | Error returned to caller; swap aborted before affecting audio path |
| **prime** | Missing history, invalid phase state | Warning logged; engine proceeds with cold start (may have transient) |
| **preWarm** | Processing error | Swap aborted; old engine continues; error surfaced to driver |
| **crossFade** | One engine fails mid-fade | Emergency cut to surviving engine; error logged |
| **retire/destroy** | Cleanup failure | Logged but not fatal; may leak resources |

### Error Classification

Failures map to Seqlok's error system domains:

| Domain | Examples |
|--------|----------|
| `env.*` | SharedArrayBuffer unavailable, AudioWorklet not supported |
| `backing.*` | Buffer allocation failed, invalid buffer state |
| `hotswap.*` | Swap timeout, prime failure, crossfade abort |

### Recovery Strategies

- **Swap failures before audio path:** Safe to retry with different config
- **Swap failures during crossfade:** Fall back to old engine if healthy, or new engine if old failed
- **Catastrophic failures:** Surface to application for user notification

> **Principle:** Failures should never cause silence. The system always falls back to *some* engine producing audio, even if it's not the desired configuration.

## Implementation Notes

### For Seqlok/Dekzer (Outer Hotswap)

The CompositeDriver owns:

- The SWSR command ring for swap requests
- SwapTicket state machine tracking active/pending engines
- Crossfade scheduling and execution
- Engine lifecycle management

Engines are purely passive—they don't know about the swap protocol, they just implement the ABI.

**Latency handling:** The driver may query per-instance latency via `EngineABI.getLatency()` and compensate at the mixer or deck level. Hotswap itself does not require perfect latency reporting; it only assumes latency is non-negative and does not change for the lifetime of an instance. Engines with different latencies can be swapped; the driver is responsible for any timeline alignment.

### For Engine Authors (Inner Hotswap)

Engine authors can apply the same pattern internally for mode switches that would otherwise cause transients. However, internal hotswaps:

- Don't need the SWSR ring or SwapTicket
- Just need to follow the mental model: "don't mutate the live kernel, build another and blend"

This keeps the canonical hotswap implementation in one place (Seqlok) while allowing the pattern to propagate.

## Relationship to Existing Technologies

| Technology | Relationship |
|------------|--------------|
| Bungee / Bungee Pro | Different algorithms behind the same ABI |
| Signalsmith-stretch | One implementation of a stretch engine |
| Rubberband, Elastique | Additional algorithms that could implement the ABI |
| Web Audio AudioWorklet | The runtime environment where engines execute |

The hotswap protocol is the "XLR connector" that all these DSP engines plug into.

## Future Considerations

- **Cross-language ABI:** C/C++ header for native engine implementations
- **Engine capability discovery:** Querying what parameters are structural vs non-structural
- **Advanced latency compensation:** Automatic timeline alignment when swapping between engines with different latencies
- **Resource budgeting:** CPU/memory constraints for quality tier selection
