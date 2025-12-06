# Seqlok Engine SDK Guide

> **Version:** 0.1.0-draft  
> **Status:** Design Document  
> **Audience:** DSP engine authors integrating with Seqlok/Dekzer

## Introduction

This guide is for audio DSP engineers who want their engines (time-stretch algorithms, effects processors, synthesizers, etc.) to work seamlessly with Seqlok's hotswap protocol. By implementing a simple ABI, your engine gets:

- **Sample-accurate hotswap:** Configuration changes without glitches
- **Musical scheduling:** Swaps aligned to beats, bars, or specific sample positions
- **Automatic crossfades:** Smooth transitions handled by the host
- **Command ring integration:** Thread-safe configuration requests

You focus on DSP. Seqlok handles orchestration.

> **Note on algorithm names:** Examples in this guide reference Signalsmith, Bungee, Bungee Pro, etc. These are illustrative. The initial Seqlok implementation focuses on Signalsmith-based engines (varispeed + stretch); other algorithms demonstrate how the ABI generalizes.

## The Contract

Your engine must satisfy one fundamental contract:

> **Engines are side-effect-free with respect to configuration.**
> 
> All structural configuration changes happen via a *new instance*, not by mutating the active engine. You must tolerate being run in parallel with another instance during the blend phase.

This means:

1. Once constructed, your engine's structural parameters are immutable
2. Your `process()` function produces deterministic output for a given input and config
3. Two instances of your engine can run simultaneously without interfering with each other

## TypeScript ABI

The canonical interface is `EngineABI`. In TypeScript, this is typically implemented as an object or class.

> **Example:** This section uses `StretchEngineConfig` as the concrete example. See the [Stretch Engine Config Specification](../../../../docs/engines/seqlok-stretch-engine-config-spec.md) for the full definition. Other engine families (FX, synths, analyzers) define their own config profiles but plug into the same `EngineABI`.

```typescript
/**
 * StretchEngineConfig - Configuration for time-stretch engines.
 * See the Stretch Engine Config Specification for full details.
 */
interface StretchEngineConfig {
  /** Schema version for forward compatibility */
  readonly version: 1;

  algorithm: 'varispeed' | 'signalsmith' | 'bungee-basic' | 'bungee-pro';
  qualityTier: 'eco' | 'normal' | 'insane';
  sampleRate: number;
  channels: number;
  
  // Non-structural parameters (can be updated live)
  stretchRatio: number;
  pitchRatio: number;

  /** Optional vendor/engine-specific extensions */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/**
 * Context provided during the prime phase.
 * Use this to align your engine's state with the outgoing engine.
 */
interface PrimeContext {
  /** Current playback position in samples */
  positionSamples: number;
  
  /** Current playback position in seconds */
  positionSeconds: number;
  
  /** Recent input samples for look-back algorithms */
  inputHistory: readonly Float32Array[];
  
  /** Number of valid samples in inputHistory */
  historyLength: number;
  
  /** Optional: phase state from outgoing engine (opaque) */
  phaseState?: unknown;
}

/**
 * EngineABI - The canonical engine interface.
 * 
 * All engines implement this interface regardless of their domain
 * (stretch, FX, synth, etc.). The TConfig type parameter determines
 * what configuration the engine accepts.
 */
interface EngineABI<TConfig, THandle> {
  /**
   * Create a new engine instance.
   * 
   * Called OFF the audio thread. May allocate memory, initialize FFT tables,
   * load resources, etc. No real-time constraints.
   * 
   * @param config - Immutable configuration for this instance
   * @returns Opaque handle to the engine instance
   */
  create(config: TConfig): THandle;

  /**
   * Prepare the engine to produce seamless output from its first sample.
   * 
   * Called OFF the audio thread, before the engine enters the audio path.
   * Use the provided context to "catch up" to the current playback position.
   * 
   * @param handle - Engine instance handle
   * @param ctx - Context from the outgoing engine / current playback state
   */
  prime(handle: THandle, ctx: PrimeContext): void;

  /**
   * Process one block of audio.
   * 
   * Called ON the audio thread. Must be real-time safe:
   * - No memory allocation
   * - No blocking operations
   * - Bounded, predictable execution time
   * 
   * @param handle - Engine instance handle
   * @param input - Input audio buffers (one per channel)
   * @param output - Output audio buffers (one per channel)
   * @param frames - Number of frames to process
   */
  process(
    handle: THandle,
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number
  ): void;

  /**
   * Update non-structural parameters on a live engine.
   * 
   * Called from the audio thread via the parameter channel.
   * Only non-structural parameters should be updateable here.
   * 
   * @param handle - Engine instance handle
   * @param params - Partial config with only non-structural fields
   */
  updateParams?(
    handle: THandle,
    params: Partial<TConfig>
  ): void;

  /**
   * Return the engine's input-to-output latency in samples.
   * 
   * Latency is non-negative and measured at the current configuration.
   * 
   * @param handle - Engine instance handle
   */
  getLatency(handle: THandle): number;

  /**
   * Release all resources.
   * 
   * May be called from a background thread after the engine is retired.
   * The handle is invalid after this call.
   * 
   * @param handle - Engine instance handle
   */
  destroy(handle: THandle): void;
}

/** Opaque handle type - your engine defines what this actually is */
type EngineHandle = unknown;
```

## C/C++ ABI

For native engines (WebAssembly, native plugins, etc.):

```c
/**
 * seqlok_engine.h - Seqlok Engine ABI for native implementations
 */

#ifndef SEQLOK_ENGINE_H
#define SEQLOK_ENGINE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Quality tier enum
 */
typedef enum {
    SEQLOK_QUALITY_ECO    = 0,
    SEQLOK_QUALITY_NORMAL = 1,
    SEQLOK_QUALITY_INSANE = 2
} seqlok_quality_t;

/**
 * Algorithm identifier enum (extensible)
 */
typedef enum {
    SEQLOK_ALGO_VARISPEED     = 0,
    SEQLOK_ALGO_SIGNALSMITH   = 1,
    SEQLOK_ALGO_BUNGEE_BASIC  = 2,
    SEQLOK_ALGO_BUNGEE_PRO    = 3,
    /* Add your algorithm here */
} seqlok_algorithm_t;

/**
 * Engine configuration (immutable after create)
 */
typedef struct {
    seqlok_algorithm_t algorithm;
    seqlok_quality_t   quality;
    int32_t            sample_rate;
    int32_t            channels;
    
    /* Non-structural (can be updated via params) */
    float              stretch_ratio;
    float              pitch_ratio;
} seqlok_config_t;

/**
 * Prime context - state needed to align with outgoing engine
 */
typedef struct {
    int64_t        position_samples;
    double         position_seconds;
    const float**  input_history;      /* Array of channel buffers */
    int32_t        history_length;     /* Samples per channel */
    const void*    phase_state;        /* Opaque, algorithm-specific */
    int32_t        phase_state_size;
} seqlok_prime_ctx_t;

/**
 * Non-structural parameter update
 */
typedef struct {
    float stretch_ratio;
    float pitch_ratio;
    /* Add other live-updateable params here */
} seqlok_params_t;

/**
 * Opaque engine handle
 */
typedef struct seqlok_engine seqlok_engine_t;

/**
 * Create a new engine instance.
 * 
 * Called off the audio thread. May allocate, may be slow.
 * 
 * @param config  Pointer to configuration (copied internally)
 * @return        New engine handle, or NULL on failure
 */
seqlok_engine_t* seqlok_engine_create(const seqlok_config_t* config);

/**
 * Prime the engine with context for seamless startup.
 * 
 * Called off the audio thread, before entering the audio path.
 * 
 * @param engine  Engine handle
 * @param ctx     Prime context with playback state
 */
void seqlok_engine_prime(seqlok_engine_t* engine, const seqlok_prime_ctx_t* ctx);

/**
 * Process one block of audio.
 * 
 * Called on the audio thread. Must be real-time safe.
 * 
 * @param engine  Engine handle
 * @param input   Array of input channel pointers
 * @param output  Array of output channel pointers
 * @param frames  Number of frames to process
 */
void seqlok_engine_process(
    seqlok_engine_t* engine,
    const float* const* input,
    float** output,
    int32_t frames
);

/**
 * Update non-structural parameters.
 * 
 * Called from the audio thread. Must be real-time safe.
 * 
 * @param engine  Engine handle
 * @param params  New parameter values
 */
void seqlok_engine_update_params(
    seqlok_engine_t* engine,
    const seqlok_params_t* params
);

/**
 * Destroy the engine and release all resources.
 * 
 * May be called from a background thread.
 * 
 * @param engine  Engine handle (invalid after this call)
 */
void seqlok_engine_destroy(seqlok_engine_t* engine);

/**
 * Query engine latency in samples.
 * 
 * Latency is the non-negative input-to-output delay at the current
 * configuration. The driver uses this to align playback timing and
 * schedule crossfades when swapping between engines with different latencies.
 * 
 * @param engine  Engine handle
 * @return        Latency in samples (non-negative)
 */
int32_t seqlok_engine_get_latency(const seqlok_engine_t* engine);

#ifdef __cplusplus
}
#endif

#endif /* SEQLOK_ENGINE_H */
```

## Implementation Checklist

### ✅ Real-Time Safety

Your `process()` function must be real-time safe:

| Requirement | Why |
|-------------|-----|
| No memory allocation | `malloc`/`new` can block unpredictably |
| No blocking I/O | File access, network, etc. block indefinitely |
| No locks/mutexes | Can cause priority inversion |
| No unbounded loops | Execution time must be predictable |
| No system calls | Most syscalls can block |

Pre-allocate everything in `create()`. Process in `process()`.

### ✅ Deterministic Output

Given the same input and config, your engine must produce the same output:

```
process(handle, input, output, frames)  // Run 1
process(handle, input, output, frames)  // Run 2
// output must be identical (or acceptably close for floating-point)
```

This enables:
- Reliable crossfading between instances
- Reproducible behavior for testing
- Sample-accurate alignment

### ✅ Parallel Instance Safety

During crossfade, two instances run simultaneously:

```
// Audio thread during crossfade:
oldEngine.process(input, oldOutput, frames);
newEngine.process(input, newOutput, frames);
// Blend oldOutput and newOutput
```

Your engines must not share mutable global state. Each instance is fully independent.

### ✅ Latency Reporting

Report your engine's algorithmic latency accurately:

```typescript
getLatency(handle: EngineHandle): number {
  const engine = getEngine(handle);
  // Example: half-FFT latency for a phase vocoder
  return engine.fftSize / 2;
}
```

**Latency semantics:**
- Report **input-to-output delay** in samples
- Must be **non-negative**
- Measured at the **current configuration** (if quality tier affects latency, report the active tier's latency)
- The driver uses this for playback alignment and crossfade scheduling

### ✅ Prime Implementation

The `prime()` function is crucial for seamless swaps. Use the provided context to:

1. **Set playback position:** So you know where you are in the timeline
2. **Fill internal buffers:** With history data so your first output isn't empty/transient
3. **Match phase (if applicable):** For phase-vocoder algorithms, align phase with outgoing engine

Example for a time-stretch engine:

```typescript
prime(handle: EngineHandle, ctx: PrimeContext): void {
  const engine = getEngine(handle);
  
  // Set position
  engine.seekToSample(ctx.positionSamples);
  
  // Fill analysis buffers with history
  if (ctx.historyLength > 0) {
    for (let ch = 0; ch < engine.channels; ch++) {
      engine.feedHistory(ch, ctx.inputHistory[ch], ctx.historyLength);
    }
  }
  
  // Run internal analysis to fill FFT frames, etc.
  engine.analyzeHistory();
}
```

## Parameter Classification Guide

When designing your config, classify each parameter:

### Structural (Require Hotswap)

Parameters that:
- Change buffer sizes or allocation
- Alter the processing algorithm fundamentally
- Would cause transients if changed live
- Your library docs say "requires reinit"

Examples:
- FFT size, window length, hop size
- Algorithm mode (basic vs. HQ)
- Sample rate, channel count
- Transient detection mode

### Non-Structural (Live Update)

Parameters that:
- Can be interpolated smoothly
- Don't affect buffer sizes
- Your library handles gracefully

Examples:
- Time-stretch ratio
- Pitch-shift ratio
- Wet/dry mix
- Gain controls

**Rule of thumb:** If you're not sure, make it structural. It's always safe to hotswap; it's not always safe to mutate live.

## Testing Your Engine

### Basic Functionality

```typescript
describe('MyEngine', () => {
  it('creates and destroys without leaks', () => {
    const config = makeTestConfig();
    const handle = engine.create(config);
    engine.destroy(handle);
    // Check for memory leaks
  });

  it('processes silence correctly', () => {
    const handle = engine.create(makeTestConfig());
    const input = [new Float32Array(512)];
    const output = [new Float32Array(512)];
    
    engine.process(handle, input, output, 512);
    
    // Output should be silence (or very close)
    expect(maxAbs(output[0])).toBeLessThan(1e-6);
    
    engine.destroy(handle);
  });

  it('produces deterministic output', () => {
    const config = makeTestConfig();
    const input = [generateTestSignal(1024)];
    
    const handle1 = engine.create(config);
    const output1 = [new Float32Array(1024)];
    engine.process(handle1, input, output1, 1024);
    engine.destroy(handle1);
    
    const handle2 = engine.create(config);
    const output2 = [new Float32Array(1024)];
    engine.process(handle2, input, output2, 1024);
    engine.destroy(handle2);
    
    expect(output1[0]).toEqual(output2[0]);
  });
});
```

### Hotswap Simulation

```typescript
describe('Hotswap compatibility', () => {
  it('runs two instances in parallel', () => {
    const config = makeTestConfig();
    const input = [generateTestSignal(512)];
    
    const handle1 = engine.create(config);
    const handle2 = engine.create(config);
    
    const output1 = [new Float32Array(512)];
    const output2 = [new Float32Array(512)];
    
    // Simulate parallel processing during crossfade
    engine.process(handle1, input, output1, 512);
    engine.process(handle2, input, output2, 512);
    
    // Both should produce valid output
    expect(isValidAudio(output1[0])).toBe(true);
    expect(isValidAudio(output2[0])).toBe(true);
    
    engine.destroy(handle1);
    engine.destroy(handle2);
  });

  it('primes correctly for seamless transition', () => {
    const config = makeTestConfig();
    const history = [generateTestSignal(2048)];
    
    const handle = engine.create(config);
    engine.prime(handle, {
      positionSamples: 44100,
      positionSeconds: 1.0,
      inputHistory: history,
      historyLength: 2048,
    });
    
    const output = [new Float32Array(512)];
    engine.process(handle, [new Float32Array(512)], output, 512);
    
    // First output block should not have startup transients
    expect(hasTransient(output[0])).toBe(false);
    
    engine.destroy(handle);
  });
});
```

## Common Pitfalls

### ❌ Global Mutable State

```cpp
// BAD: Shared state between instances
static float g_lastSample = 0.0f;

void process(engine_t* e, ...) {
    output[0] = g_lastSample;  // Wrong!
    g_lastSample = input[0];
}
```

```cpp
// GOOD: Instance state
struct engine_t {
    float lastSample;
};

void process(engine_t* e, ...) {
    output[0] = e->lastSample;
    e->lastSample = input[0];
}
```

### ❌ Allocation in Process

```cpp
// BAD: Allocation on audio thread
void process(engine_t* e, ...) {
    float* temp = malloc(frames * sizeof(float));  // Wrong!
    // ...
    free(temp);
}
```

```cpp
// GOOD: Pre-allocated buffers
engine_t* create(config_t* cfg) {
    engine_t* e = malloc(sizeof(engine_t));
    e->tempBuffer = malloc(MAX_FRAMES * sizeof(float));
    return e;
}

void process(engine_t* e, ...) {
    float* temp = e->tempBuffer;  // Pre-allocated
    // ...
}
```

### ❌ Ignoring Prime Context

```typescript
// BAD: Ignoring prime, cold start
prime(handle: EngineHandle, ctx: PrimeContext): void {
  // Do nothing
}
```

```typescript
// GOOD: Use context for warm start
prime(handle: EngineHandle, ctx: PrimeContext): void {
  const engine = getEngine(handle);
  engine.seekTo(ctx.positionSamples);
  engine.feedHistory(ctx.inputHistory, ctx.historyLength);
  engine.warmUp();
}
```

## Integration Example

Here's a complete minimal example of a passthrough "engine" implementing `EngineABI`:

```typescript
interface PassthroughConfig {
  channels: number;
  gain: number;  // Non-structural
}

interface PassthroughHandle {
  channels: number;
  gain: number;
}

const passthroughEngine: EngineABI<PassthroughConfig, PassthroughHandle> = {
  create(config: PassthroughConfig): PassthroughHandle {
    return {
      channels: config.channels,
      gain: config.gain,
    };
  },

  prime(handle: PassthroughHandle, ctx: PrimeContext): void {
    // Passthrough doesn't need history
  },

  process(
    handle: PassthroughHandle,
    input: readonly Float32Array[],
    output: Float32Array[],
    frames: number
  ): void {
    for (let ch = 0; ch < handle.channels; ch++) {
      for (let i = 0; i < frames; i++) {
        output[ch][i] = input[ch][i] * handle.gain;
      }
    }
  },

  updateParams(handle: PassthroughHandle, params: Partial<PassthroughConfig>): void {
    if (params.gain !== undefined) {
      handle.gain = params.gain;
    }
  },

  getLatency(handle: PassthroughHandle): number {
    return 0; // Passthrough has zero latency
  },

  destroy(handle: PassthroughHandle): void {
    // Nothing to clean up
  },
};
```

## Summary

To make your engine Seqlok-compatible:

1. **Implement the `EngineABI`:** `create`, `prime`, `process`, `getLatency`, `destroy`
2. **Be real-time safe:** No allocation, no blocking in `process()`
3. **Be deterministic:** Same input + config = same output
4. **Support parallel instances:** No shared mutable state
5. **Use prime effectively:** Fill buffers, match state for seamless swaps
6. **Classify parameters:** Structural vs. non-structural
7. **Report latency accurately:** Input-to-output delay at current config

Follow these guidelines, and your engine plugs into Seqlok's hotswap protocol with zero effort on your part for orchestration, scheduling, and crossfading.

You build the DSP. Seqlok handles the rest.
