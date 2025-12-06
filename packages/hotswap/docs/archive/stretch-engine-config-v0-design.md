# Stretch Engine Configuration Specification

> **Version:** 0.1.0-draft  
> **Status:** Design Document  
> **Scope:** Universal configuration interface for time-stretch/pitch-shift engines

## Overview

The `StretchEngineConfig` defines a universal configuration contract that all time-stretch and pitch-shift engines agree on. This abstraction allows Seqlok to treat different algorithms (Signalsmith-stretch, Bungee, Bungee Pro, varispeed, etc.) as interchangeable implementations behind a common interface.

## Design Goals

1. **Algorithm-agnostic:** The config describes *what* you want, not *how* to achieve it
2. **Hotswap-aware:** Clear separation between structural and non-structural parameters
3. **Minimal surface area:** Only parameters that matter for the swap protocol
4. **Extensible:** Room for algorithm-specific flags without breaking the core contract

## Configuration Types

### StretchAlgorithm

Identifies which algorithm implementation to use:

```typescript
type StretchAlgorithm =
  | 'varispeed'        // Simple resampling, no time-stretch
  | 'signalsmith'      // Signalsmith-stretch (open source, high quality)
  | 'bungee-basic'     // Bungee open-source engine
  | 'bungee-pro'       // Bungee Pro (proprietary, AI-assisted)
  // Future algorithms can be added here
  ;
```

### QualityTier

Defines the quality/CPU trade-off:

```typescript
type QualityTier =
  | 'eco'      // Minimal CPU, acceptable quality
  | 'normal'   // Balanced (default)
  | 'insane'   // Maximum quality, high CPU
  ;
```

Quality tiers map to algorithm-specific settings (FFT size, window length, overlap, etc.) but the host doesn't need to know those details.

> **Cross-language note:** In the C ABI, `QualityTier` maps 1:1 to `seqlok_quality_t` (`SEQLOK_QUALITY_ECO`, `SEQLOK_QUALITY_NORMAL`, `SEQLOK_QUALITY_INSANE`). Similarly, `StretchAlgorithm` maps to `seqlok_algorithm_t`. The naming differs by language convention, but the semantics are identical.

### StretchEngineConfig

The complete configuration for a stretch engine instance:

```typescript
interface StretchEngineConfig {
  /** Schema version for forward compatibility */
  readonly version: 1;

  /** Which algorithm implementation to use */
  algorithm: StretchAlgorithm;

  /** Time-stretch ratio (1.0 = original speed, 2.0 = half speed, 0.5 = double speed) */
  stretchRatio: number;

  /** Pitch-shift ratio (1.0 = original pitch, 2.0 = octave up, 0.5 = octave down) */
  pitchRatio: number;

  /** Quality/CPU trade-off */
  qualityTier: QualityTier;

  /** Sample rate in Hz */
  sampleRate: number;

  /** Number of audio channels */
  channels: number;

  /** 
   * Optional vendor/engine-specific extensions.
   * The host passes this through opaquely; engines may use it for
   * algorithm-specific tuning without requiring Seqlok schema changes.
   */
  readonly extensions?: Readonly<Record<string, unknown>>;
}
```

> **Note:** The `version` field is readonly and always `1` for this specification version. It enables graceful migration when the schema evolves.

> **About `extensions`:** This optional field follows the same pattern as `PrimeContext.phaseState`—an opaque bag the host ignores but engines can use for custom data. It prevents "one more field" pressure on the core schema. If unused, omit it entirely.

## Parameter Classification

### Structural Parameters (Trigger Hotswap)

Changes to these parameters require creating a new engine instance:

| Parameter | Rationale |
|-----------|-----------|
| `algorithm` | Different algorithm = different engine type entirely |
| `qualityTier` | Typically changes FFT size, window length, internal buffers |
| `sampleRate` | Requires reinitialization of all internal filters/tables |
| `channels` | Changes buffer allocation and processing topology |

### Non-Structural Parameters (Live Update)

Changes to these parameters can be applied to a running engine:

| Parameter | Rationale |
|-----------|-----------|
| `stretchRatio` | Most algorithms handle ratio changes smoothly |
| `pitchRatio` | Most algorithms handle pitch changes smoothly |

## Comparison Semantics

Two configs are considered **structurally equivalent** if they would produce the same engine instance (ignoring non-structural parameters):

```typescript
function structurallyEquivalent(a: StretchEngineConfig, b: StretchEngineConfig): boolean {
  return (
    a.algorithm === b.algorithm &&
    a.qualityTier === b.qualityTier &&
    a.sampleRate === b.sampleRate &&
    a.channels === b.channels
    // Note: extensions are ignored by the host's equivalence check
  );
}
```

If two configs are structurally equivalent, a hotswap is not required—only parameter updates.

> **Extensions and equivalence:** The host ignores `extensions` when comparing configs. However, engine implementations may treat certain extension fields as structural internally. If an engine needs extension-triggered hotswaps, it should document which extension keys are structural.

## Config Validation

### Constraints

```typescript
interface StretchEngineConfigConstraints {
  stretchRatio: {
    min: 0.1;    // 10x faster
    max: 10.0;   // 10x slower
  };
  pitchRatio: {
    min: 0.25;   // 2 octaves down
    max: 4.0;    // 2 octaves up
  };
  sampleRate: {
    allowed: [44100, 48000, 88200, 96000];
  };
  channels: {
    min: 1;
    max: 2;      // Stereo max for v0.1
  };
}
```

> **v0.1 Channel Constraint:** The 1–2 channel limit is deliberately conservative for this version. Future versions may expand to support multi-bus scenarios (e.g., 4-stem separation, 5.1 surround). The extension path would likely model multi-bus as either (a) separate engine instances per stem, or (b) a single engine with an explicit `busCount` parameter. This is deferred to avoid premature complexity.

### Validation Function

```typescript
type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

function validateStretchConfig(config: StretchEngineConfig): ValidationResult {
  const errors: string[] = [];

  if (config.stretchRatio < 0.1 || config.stretchRatio > 10.0) {
    errors.push(`stretchRatio ${config.stretchRatio} out of range [0.1, 10.0]`);
  }

  if (config.pitchRatio < 0.25 || config.pitchRatio > 4.0) {
    errors.push(`pitchRatio ${config.pitchRatio} out of range [0.25, 4.0]`);
  }

  if (![44100, 48000, 88200, 96000].includes(config.sampleRate)) {
    errors.push(`sampleRate ${config.sampleRate} not in allowed set`);
  }

  if (config.channels < 1 || config.channels > 2) {
    errors.push(`channels ${config.channels} out of range [1, 2]`);
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
```

## Algorithm Dispatch

The config's `algorithm` field determines which engine implementation is instantiated:

```typescript
type EngineFactory = (config: StretchEngineConfig) => EngineHandle;

const engineFactories: Record<StretchAlgorithm, EngineFactory> = {
  'varispeed': createVarispeedEngine,
  'signalsmith': createSignalsmithEngine,
  'bungee-basic': createBungeeBasicEngine,
  'bungee-pro': createBungeeProEngine,
};

function createEngine(config: StretchEngineConfig): EngineHandle {
  const factory = engineFactories[config.algorithm];
  if (!factory) {
    throw new Error(`Unknown algorithm: ${config.algorithm}`);
  }
  return factory(config);
}
```

## Quality Tier Mappings

Each algorithm maps quality tiers to its own internal settings. These mappings are implementation details hidden from the host:

### Signalsmith-stretch (Example)

| Tier | FFT Size | Window | Overlap |
|------|----------|--------|---------|
| eco | 1024 | Hann | 4x |
| normal | 2048 | Hann | 4x |
| insane | 4096 | Kaiser | 8x |

### Bungee (Example)

| Tier | Mode | Notes |
|------|------|-------|
| eco | Basic | Minimal processing |
| normal | Standard | Default quality |
| insane | HQ | Full AI-assisted processing (Pro only) |

The host never needs to know these details—it just requests a tier and the engine figures out the rest.

## Relationship to Hotswap Protocol

The `StretchEngineConfig` is the "config snapshot" referenced in the hotswap lifecycle:

1. **Spawn:** `create(config)` receives a `StretchEngineConfig`
2. **Prime:** Context is provided based on the config's structural parameters
3. **CrossFade:** Both engines share the same structural config (or we wouldn't be crossfading)
4. **Parameter Updates:** Non-structural changes go through a separate channel

### Change Detection

When a new config is requested:

```typescript
function determineAction(
  current: StretchEngineConfig,
  requested: StretchEngineConfig
): 'noop' | 'paramUpdate' | 'hotswap' {
  // No change at all
  if (deepEqual(current, requested)) {
    return 'noop';
  }

  // Structural change → full hotswap
  if (!structurallyEquivalent(current, requested)) {
    return 'hotswap';
  }

  // Only non-structural changes → param update
  return 'paramUpdate';
}
```

## Usage Scenarios

### Scenario 1: DJ Changes Stretch Algorithm Mid-Set

```typescript
// Currently playing with Signalsmith
const current: StretchEngineConfig = {
  algorithm: 'signalsmith',
  stretchRatio: 1.0,
  pitchRatio: 1.0,
  qualityTier: 'normal',
  sampleRate: 48000,
  channels: 2,
};

// DJ wants to switch to Bungee Pro for better quality
const requested: StretchEngineConfig = {
  ...current,
  algorithm: 'bungee-pro',
  qualityTier: 'insane',
};

// Result: hotswap (algorithm and qualityTier changed)
```

### Scenario 2: Tempo Change During Playback

```typescript
// Currently playing at original tempo
const current: StretchEngineConfig = {
  algorithm: 'signalsmith',
  stretchRatio: 1.0,
  pitchRatio: 1.0,
  qualityTier: 'normal',
  sampleRate: 48000,
  channels: 2,
};

// DJ adjusts tempo slider
const requested: StretchEngineConfig = {
  ...current,
  stretchRatio: 1.05, // 5% slower
};

// Result: paramUpdate (only stretchRatio changed)
```

### Scenario 3: Quality Upgrade for Recording

```typescript
// Live performance with eco quality
const current: StretchEngineConfig = {
  algorithm: 'signalsmith',
  stretchRatio: 0.95,
  pitchRatio: 1.0,
  qualityTier: 'eco',
  sampleRate: 48000,
  channels: 2,
};

// About to record, switch to insane quality
const requested: StretchEngineConfig = {
  ...current,
  qualityTier: 'insane',
};

// Result: hotswap (qualityTier changed)
```

## Extension Points

### Algorithm-Specific Options

Engines may use the `extensions` bag for algorithm-specific options that don't belong in the core schema:

```typescript
const config: StretchEngineConfig = {
  version: 1,
  algorithm: 'signalsmith',
  qualityTier: 'normal',
  sampleRate: 48000,
  channels: 2,
  stretchRatio: 1.0,
  pitchRatio: 1.0,
  extensions: {
    'signalsmith.windowShape': 'blackman',
    'signalsmith.transientSharpness': 0.8,
    'bungee.noiseFloor': -90,
  },
};
```

These options are passed through to the engine factory but don't affect the host's structural equivalence checks. Engines should namespace their extension keys (e.g., `signalsmith.*`, `bungee.*`) to avoid collisions.

### Feature Flags

Future additions might include:

```typescript
interface StretchEngineConfig {
  // ... base fields ...

  /** Preserve formants during pitch shift */
  formantPreservation?: boolean;

  /** Transient handling mode */
  transientMode?: 'crisp' | 'smooth' | 'mixed';
}
```

Any such additions would need to be classified as structural or non-structural.

## Versioning

The config schema is versioned via the `version` field:

```typescript
interface StretchEngineConfig {
  /** Schema version - always 1 for this spec version */
  readonly version: 1;
  // ... rest of fields ...
}
```

**Migration rules:**

- Configs with `version: 1` conform to this specification
- Future versions will increment this field
- Older configs can be migrated by factory functions:

```typescript
function migrateConfig(config: unknown): StretchEngineConfig {
  const c = config as { version?: number };
  if (c.version === undefined || c.version === 1) {
    return config as StretchEngineConfig;
  }
  throw new Error(`Unknown config version: ${c.version}`);
}
```

- Engines should reject configs with unrecognized versions rather than guessing
