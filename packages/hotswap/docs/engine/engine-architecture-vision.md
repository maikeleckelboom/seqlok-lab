# Seqlok Engine Architecture Vision

> **Version:** 0.1.0-draft  
> **Status:** Vision Document  
> **Purpose:** Articulate the architectural goals and philosophy for Seqlok's engine system

## Executive Summary

Seqlok provides a generic, reusable infrastructure for managing real-time audio DSP engines. The core insight is that configuration changes in audio engines—algorithm switches, quality tier changes, buffer size adjustments—should be treated as *instance replacements* rather than *live mutations*.

This document captures the vision, goals, and architectural principles that guide the design.

## The Problem

Traditional audio engines expose configuration APIs that can be called at any time:

```cpp
// The problematic pattern
engine->setQuality(HIGH);      // What happens to in-flight audio?
engine->setFFTSize(4096);      // Does this cause a glitch?
engine->setAlgorithm(BUNGEE);  // Is this even safe mid-stream?
```

This creates several problems:

1. **Undefined behavior during transitions:** What does the engine output while reconfiguring?
2. **Transients and glitches:** Internal state invalidation causes audible artifacts
3. **Unbounded latency:** Some changes require expensive recomputation
4. **Race conditions:** Control thread and audio thread fighting over state
5. **Engine-specific workarounds:** Every engine handles this differently

The result: application developers write ad-hoc "stop → reconfigure → restart" code, or accept glitches, or avoid configuration changes entirely.

## The Solution

Seqlok inverts the model:

> **Engines are immutable configuration snapshots.**

When you need a different configuration, you don't modify the running engine—you:

1. **Spawn** a new engine with the desired config
2. **Prime** it with context to produce seamless output from the start
3. **Crossfade** between old and new over a musically appropriate duration
4. **Retire** the old engine

The engine itself never changes. The *active engine* changes.

This is analogous to:
- **Blue-green deployment** in web services
- **Double-buffering** in graphics
- **Immutable data structures** in functional programming

## Core Principles

### Principle 1: No Live Configure

The fundamental invariant:

> **No live `configure()` on the active engine.**

If a parameter change would cause transients, require reallocation, or invalidate internal state, it must go through the hotswap protocol. The engine under the audio pointer is never mutated in ways that affect its processing characteristics.

### Principle 2: Engines Are Black Boxes

From Seqlok's perspective, engines are opaque:

```
Input Audio → [Engine] → Output Audio
                ↑
            Immutable Config
```

Seqlok doesn't care what's inside the box—Signalsmith-stretch, Bungee, Bungee Pro, a custom algorithm. It only cares that the box:

- Was constructed with a specific config
- Produces deterministic output for that config
- Can run alongside another instance during crossfade

### Principle 3: Structural vs. Non-Structural

Not all parameters are equal:

| Type | Example | Handling |
|------|---------|----------|
| **Structural** | Algorithm, FFT size, quality tier | Hotswap |
| **Non-Structural** | Stretch ratio, pitch, gain | Live update |

Structural changes affect the engine's internal architecture. Non-structural changes are smooth knob turns the engine already handles gracefully.

### Principle 4: One Protocol, Many Engines

The hotswap protocol is defined once at the Seqlok layer:

```
Seqlok CompositeDriver
├── SWSR Command Ring
├── SwapTicket State Machine
├── Musical Scheduling
└── Crossfade Execution
     │
     ├── SignalsmithEngine
     ├── BungeeEngine
     ├── BungeeProEngine
     ├── VarispeedEngine
     └── [Your Engine Here]
```

Engine authors implement a simple ABI. They don't reinvent the orchestration.

> The concrete `EngineABI<TConfig, THandle>` interface is defined in the [Engine SDK Guide](engine-sdk-guide.md). All engines—stretch, FX, synth, analyzer—implement this same interface.

### Principle 5: Musical Awareness

Hotswaps are scheduled musically:

- **Beat-aligned:** Swap on the next downbeat
- **Bar-aligned:** Swap at the start of bar 65
- **Sample-accurate:** Swap at sample 2,116,800

Crossfade durations are also musical: "blend over 2048 samples" or "blend over half a beat."

## Non-Goals

To prevent scope creep, these concerns are explicitly **outside** the engine/hotswap layer:

- **Plugin packaging and distribution:** How engines are bundled, versioned, or installed
- **UI control layouts, mappings, or skins:** Visual representation of engine parameters
- **Long-running asset management:** Sample libraries, ML model downloads, preset banks
- **Network synchronization:** Multi-device or cloud-based engine state
- **Undo/redo for config changes:** Application-level concern, not protocol-level

These belong to Dekzer or higher application layers. The engine ABI and hotswap protocol focus solely on real-time audio processing and safe configuration transitions.

## Engine Categories

The current specification is stretch-centric, but the `EngineABI` pattern applies to multiple engine families:

| Category | Config Profile | Examples |
|----------|---------------|----------|
| **Stretch** | `StretchEngineConfig` | Signalsmith, Bungee, varispeed |
| **FX** | `FxEngineConfig` (future) | Reverb, delay, compressor |
| **Synth** | `SynthEngineConfig` (future) | Oscillators, samplers |
| **Analyzer** | `AnalyzerEngineConfig` (future) | Spectrum, waveform, beat detection |

Each category defines its own config profile with appropriate structural/non-structural splits, but all plug into the same `EngineABI` and benefit from the same hotswap protocol.

For v0.1, only `StretchEngineConfig` is fully specified. The architecture is designed to accommodate additional profiles without protocol changes.

## The Engine Ecosystem

### Outer Hotswap (Seqlok's Job)

Seqlok owns:

- The command ring for swap requests
- Scheduling swaps to musical positions
- Managing the `spawn → prime → preWarm → crossFade → retire` lifecycle
- Blending outputs during crossfade

Engines are passive recipients of this orchestration.

### Inner Hotswap (Engine Author's Choice)

Engine authors can apply the same pattern internally:

> "I have an internal mode switch that causes transients. I'll build a second kernel, run them in parallel, blend, and retire the old one."

But this inner use doesn't need Seqlok's infrastructure—just the mental model. Keep the canonical implementation in one place.

## The "XLR Connector" Analogy

Think of the Seqlok engine ABI as an XLR connector for DSP:

- **Simple, standardized interface:** `create`, `prime`, `process`, `destroy`
- **Everything interesting plugs into it:** Stretchers, effects, synths
- **Interoperability:** Swap Signalsmith for Bungee Pro like swapping a mic

The connector doesn't care what's on the other end. It just defines the electrical/mechanical interface. Similarly, Seqlok doesn't care about the DSP—it defines the lifecycle interface.

## Concrete Example: Bungee vs. Bungee Pro

The Bungee project demonstrates this perfectly:

- **Bungee (open source):** Phase-vocoder stretcher, decent quality
- **Bungee Pro (proprietary):** AI-assisted, higher quality, same API

> **Note:** These algorithm names are illustrative; v0.1 targets Signalsmith-based engines. Bungee/Bungee Pro demonstrate how different algorithms fit behind the same config/ABI.

From Seqlok's perspective, these are just different `algorithm` values:

```typescript
// Switch from open-source to Pro mid-set
const currentConfig: StretchEngineConfig = {
  algorithm: 'bungee-basic',
  qualityTier: 'normal',
  // ...
};

const requestedConfig: StretchEngineConfig = {
  algorithm: 'bungee-pro',
  qualityTier: 'insane',
  // ...
};

// Seqlok handles the swap automatically
driver.requestConfigChange(requestedConfig, { alignTo: 'bar' });
```

The DJ doesn't experience a glitch. The algorithm change is as smooth as a gain knob.

## Benefits for Stakeholders

### For Application Developers (Dekzer)

- **Predictable behavior:** Config changes always work the same way
- **No glitch hunting:** The protocol guarantees clean transitions
- **Musical control:** Schedule changes to musical positions
- **Algorithm freedom:** Swap engines without changing application code

### For Engine Authors (DSP Engineers)

- **Simple contract:** Implement four functions, get hotswap for free
- **Focus on DSP:** Don't worry about thread safety, scheduling, crossfading
- **Interoperability:** Your engine works with any Seqlok-based host
- **Clear requirements:** Real-time safety, determinism, parallel-safety

### For End Users (DJs, Producers)

- **Glitch-free transitions:** Change quality settings mid-performance
- **Algorithm experimentation:** Compare Signalsmith vs. Bungee live
- **Professional reliability:** The system behaves predictably

## Future Directions

### Cross-Language ABI

The TypeScript ABI is primary for Web Audio. A C ABI enables:

- WebAssembly engines
- Native plugin formats (VST, AU, LV2)
- Rust implementations

### Engine Capability Discovery

Engines could advertise:

- Which parameters are structural vs. non-structural
- Latency characteristics
- CPU/memory requirements per quality tier
- Supported sample rates and channel counts

### Engine Packs

Third parties could ship "engine packs":

```
Seqlok Pro Stretch Pack
├── Signalsmith (included)
├── Bungee Basic (included)
├── Bungee Pro (licensed)
└── [Future Algorithm] (modular)
```

Install an engine, it appears in the algorithm dropdown, and hotswap handles it.

### Quality-Adaptive Scheduling

The system could automatically select quality tiers based on:

- Current CPU load
- Number of active decks
- Importance of the track (is it live in the mix?)

## Summary

Seqlok's engine architecture is built on a simple but powerful insight:

> **Treat configuration changes as instance replacements, not live mutations.**

This unlocks:

- Glitch-free configuration changes
- Musical scheduling of transitions
- Algorithm interoperability
- Clean separation between DSP and orchestration

Design it once, make it nice, and every future engine plugs in and gets safe live swaps for free.

---

## Related Documents

- [Hotswap Lifecycle Specification](engine-lifecycle-spec.md) — Protocol details
- [Stretch Engine Config Specification](../../../../docs/engines/seqlok-stretch-engine-config-spec.md) — Configuration contract
- [Engine SDK Guide](engine-sdk-guide.md) — Implementation guide for engine authors
