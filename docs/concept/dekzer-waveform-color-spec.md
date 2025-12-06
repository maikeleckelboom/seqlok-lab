# Dekzer Waveform Color Pipeline Specification

**Version:** 0.2.2  
**Status:** Design Specification  
**Last Updated:** December 2025

---

## Executive Summary

This document specifies a perceptually uniform color pipeline for Dekzer's waveform visualization system. By using
OKLab/OKLCH color space with Display P3 gamut targeting, Dekzer achieves scientifically correct frequency-to-color
mapping that surpasses traditional DJ software (Serato, Traktor) in both accuracy and visual clarity.

**Core thesis:** We're not picking colors—we're calculating vectors in a perceptually uniform space. This is "Verified
by Math."

**Design goal:** By mapping total normalized energy into OKLCH lightness (L), and using the OKLab (a,b) plane to encode
spectral balance, blocks with the same total energy appear with similar perceived brightness while still showing
different frequency content in their hue/chroma. This is a property of *our mapping* built on a perceptual color space,
not an intrinsic guarantee of OKLCH.

---

## 1. Why OKLCH Over sRGB/HSL

### The Problem with Traditional Approaches

Traditional DJ waveforms (Serato, Traktor, Rekordbox) color-code tracks by mapping frequency bands to RGB colors in the
standard sRGB display space, often via simple HSV/HSL-style gradients or hand-tuned RGB ramps. This produces:

- **Muddy blends:** Mixing Red (Bass) and Blue (Hi-hats) produces dark purple that appears "quieter" than pure colors
- **Non-perceptual gradients:** Frequency sweeps look jumpy rather than smooth
- **Limited gamut:** Constrained to sRGB, missing the vibrant saturation modern displays can produce

### The OKLab/OKLCH Advantage

OKLab is a modern perceptual color space designed so that:

- **Lightness (L)** tracks perceived brightness far better than RGB/HSL
- **a/b axes** are opponent axes (green↔red, blue↔yellow) forming a Cartesian plane
- **Euclidean distances** in (L,a,b) correlate much more closely with perceived color differences than in RGB/HSL

OKLCH is the cylindrical form (Lightness, Chroma, Hue) derived from OKLab's Cartesian coordinates.

**Key property:** OKLab is *more* perceptually uniform than CIELAB or HSL, though still an approximation of human
vision. It's good enough that distances in (L,a,b) are meaningful for our purposes.

---

## 2. Color Space Architecture

### 2.1 Canvas Configuration

To access the wider P3 gamut on capable displays:

```typescript
const ctx = canvas.getContext('2d', {
  colorSpace: 'display-p3',
  alpha: true
});
```

This unlocks saturated cyans, magentas, and reds that glow on MacBooks/iPhones.

**Browser support:** `colorSpace: "display-p3"` is supported on modern browsers (Safari, recent Chromium). On others,
the context falls back to sRGB; the pipeline still works, just with a narrower gamut.

### 2.2 Band Vector Definitions

Each frequency band maps to a vector direction in the OKLab (a, b) plane:

```typescript
// Pre-calculated constants: directions in OKLab color space
const VEC_LOW = {a: 0.25, b: 0.10}; // Bass: Red/Magenta direction
const VEC_MID = {a: -0.20, b: 0.10}; // Mids/Vocals: Green direction
const VEC_HIGH = {a: -0.05, b: -0.25}; // Highs/Air: Blue/Cyan direction
```

**Why vectors, not hues?** You cannot average hue angles correctly (averaging 0° Red and 120° Green gives 60°
Yellow—wrong). Vector summation in Cartesian space produces mathematically correct blends.

---

## 3. Core Algorithm

### 3.0 Input Contract

All band energies (`lowEnergy`, `midEnergy`, `highEnergy`) are normalized to `[0, 1]`, where `1.0` corresponds to the
chosen reference level (e.g., 0 dBFS after windowing).

Normalization happens *before* passing values into the color pipeline. The color spec is independent from "how loud is
loud" in the audio engine.

### 3.1 TypeScript Implementation

```typescript
interface BandVectors {
  readonly a: number;
  readonly b: number;
}

const VEC_LOW: BandVectors = {a: 0.25, b: 0.10};
const VEC_MID: BandVectors = {a: -0.20, b: 0.10};
const VEC_HIGH: BandVectors = {a: -0.05, b: -0.25};

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function getColorForBlock(
  lowEnergy: number,
  midEnergy: number,
  highEnergy: number
): string {
  // 1. Weighted vector summation in (a, b) plane
  const a = (VEC_LOW.a * lowEnergy) + (VEC_MID.a * midEnergy) + (VEC_HIGH.a * highEnergy);
  const b = (VEC_LOW.b * lowEnergy) + (VEC_MID.b * midEnergy) + (VEC_HIGH.b * highEnergy);

  // 2. Chroma from vector magnitude (clamped to avoid gamut clipping)
  const rawChroma = Math.hypot(a, b) * 1.2;
  const chroma = clamp(rawChroma, 0, 0.4);

  // 3. Hue angle from vector direction
  const hue = Math.atan2(b, a) * (180 / Math.PI);

  // 4. Lightness from total energy
  // Using peak energy for punchy display (alternative: RMS or sum)
  const peakEnergy = Math.max(lowEnergy, midEnergy, highEnergy);
  const lightness = clamp(0.5 + (peakEnergy * 0.4), 0, 1);

  // 5. Return CSS oklch() string (browser handles P3 conversion)
  return `oklch(${lightness} ${chroma} ${hue})`;
}
```

### 3.2 Critical Implementation Notes

**Chroma clamping:** CSS Color 4 defines useful chroma range as 0–0.4. Beyond that, browsers silently clamp to garbage
values. Always clamp.

**Lightness mapping:** The `0.5 + (energy * 0.4)` formula keeps quiet sections visible (L ≥ 0.5) while loud sections
pop (L ≤ 0.9). Adjust coefficients per aesthetic preference.

**Energy calculation options:**

```typescript
// Option A: Peak energy (punchy, current implementation)
const energy = Math.max(lowEnergy, midEnergy, highEnergy);

// Option B: RMS energy (physically accurate)
const energy = Math.sqrt(
  lowEnergy * lowEnergy +
  midEnergy * midEnergy +
  highEnergy * highEnergy
);

// Option C: Perceptual (dB-scaled)
function toPerceptualEnergy(x: number): number {
  const eps = 1e-6;
  const db = 20 * Math.log10(x + eps);
  const norm = (db + 60) / 60; // Map [-60dB, 0dB] → [0, 1]
  return clamp(norm, 0, 1);
}
```

---

## 4. WebGPU/WGSL Implementation

For GPU-accelerated rendering, implement OKLab→RGB conversion in the fragment shader.

**Note on curve divergence:** The CPU (canvas) and GPU (WebGPU) paths may use different `L(energy)` curves while we tune
aesthetics. The TS path uses linear (`0.5 + energy * 0.4`), while WGSL uses sqrt (`0.4 + pow(energy, 0.5) * 0.5`). The
vector mixing and chroma handling remain identical across both paths.

```wgsl
// OKLab → Linear sRGB matrix (D65 illuminant)
fn oklab_to_linear_srgb(L: f32, a: f32, b: f32) -> vec3<f32> {
    let l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    return vec3<f32>(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
       -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
       -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
}

struct BandInput {
    low: f32,
    mid: f32,
    high: f32,
}

@fragment
fn main(in: BandInput) -> @location(0) vec4<f32> {
    // Band vectors (same as TypeScript)
    let vec_low  = vec2<f32>( 0.25,  0.10);
    let vec_mid  = vec2<f32>(-0.20,  0.10);
    let vec_high = vec2<f32>(-0.05, -0.25);

    // Vector mixing in (a, b) space
    let final_ab = (vec_low * in.low) + (vec_mid * in.mid) + (vec_high * in.high);

    // Lightness from max energy with perceptual curve
    let max_energy = max(max(in.low, in.mid), in.high);
    let L = 0.4 + (pow(max_energy, 0.5) * 0.5);

    // Convert OKLab → Linear RGB
    let rgb = oklab_to_linear_srgb(L, final_ab.x, final_ab.y);

    // Clamp to avoid NaN/negative from extreme inputs
    let rgb_clamped = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

    return vec4<f32>(rgb_clamped, 1.0);
}
```

**P3 swapchain note:** The matrix above targets sRGB. For true P3 output, swap to the OKLab→Display-P3 matrix when
WebGPU P3 swapchains are stable. Until then, the OS compositor handles gamut mapping.

**Transfer function note:** WebGPU swapchains expect linear RGB; the presentation path applies the transfer function (
gamma). The shader therefore outputs linear sRGB values—no manual gamma correction needed.

---

## 5. Integration with Waveform Pyramid

This color pipeline plugs directly into the LOD pyramid architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Waveform Pyramid (per bucket)                              │
│  ├── min/max amplitude  →  vertical extent                  │
│  └── low/mid/high energy →  OKLCH color via this pipeline   │
└─────────────────────────────────────────────────────────────┘
```

For each bucket at any pyramid level:

1. **Geometry:** min/max determines the bar height
2. **Color:** band energies feed `getColorForBlock()` or the WGSL shader

This separation keeps concerns clean: pyramid owns structure, color pipeline owns appearance.

### 5.1 Formal Interface Contract

For each waveform bucket at any LOD level:

| Provider           | Field        | Type              | Range                            |
|--------------------|--------------|-------------------|----------------------------------|
| Geometric pipeline | `min`        | `number`          | `[-1, 1]` (normalized amplitude) |
| Geometric pipeline | `max`        | `number`          | `[-1, 1]` (normalized amplitude) |
| Spectral pipeline  | `lowEnergy`  | `number`          | `[0, 1]`                         |
| Spectral pipeline  | `midEnergy`  | `number`          | `[0, 1]`                         |
| Spectral pipeline  | `highEnergy` | `number`          | `[0, 1]`                         |
| Color pipeline     | *returns*    | `string` (CPU)    | CSS `oklch(...)`                 |
| Color pipeline     | *returns*    | `vec3<f32>` (GPU) | `(L, a, b)` triple               |

This contract ensures the pyramid/engine code doesn't sneak in arbitrary units.

---

## 6. Band Energy Source

Band energies are computed from a short-time spectrum. This section sketches the DSP path without locking in exact bin
edges.

### 6.1 Pipeline Overview

```
Audio Buffer
    ↓
Windowed FFT (e.g., 1024 samples, Hann window)
    ↓
Magnitude spectrum (squared)
    ↓
Band summation (low/mid/high frequency ranges)
    ↓
Normalization to [0, 1]
    ↓
Color pipeline input
```

### 6.2 Suggested Band Edges

| Band | Frequency Range | Musical Content                 |
|------|-----------------|---------------------------------|
| Low  | 20 Hz – 250 Hz  | Kick, bass, sub                 |
| Mid  | 250 Hz – 4 kHz  | Vocals, snares, melodic content |
| High | 4 kHz – 20 kHz  | Hi-hats, cymbals, air, presence |

These are starting points. Final tuning depends on genre and visual aesthetics.

---

## 7. Tuning Parameters

All magic numbers consolidated for dev-mode sliders and future codegen:

### 7.1 Band Vectors

| Band | `a`     | `b`     | Perceptual Color |
|------|---------|---------|------------------|
| Low  | `0.25`  | `0.10`  | Red/Magenta      |
| Mid  | `-0.20` | `0.10`  | Green            |
| High | `-0.05` | `-0.25` | Blue/Cyan        |

### 7.2 Chroma Parameters

| Parameter    | Value | Notes                                |
|--------------|-------|--------------------------------------|
| Chroma boost | `1.2` | Multiplier on raw vector magnitude   |
| Chroma max   | `0.4` | Hard clamp (CSS Color 4 gamut limit) |

### 7.3 Lightness Curves

| Path         | Base  | Span  | Curve  | Formula                            |
|--------------|-------|-------|--------|------------------------------------|
| CPU (Canvas) | `0.5` | `0.4` | Linear | `L = 0.5 + (energy × 0.4)`         |
| GPU (WGSL)   | `0.4` | `0.5` | Sqrt   | `L = 0.4 + pow(energy, 0.5) × 0.5` |

### 7.4 dB Normalization (Optional)

| Parameter | Value    |
|-----------|----------|
| Floor     | `-60 dB` |
| Ceiling   | `0 dB`   |
| Epsilon   | `1e-6`   |

---

## 8. Shared Constants Strategy

Band vectors and tuning constants (`VEC_LOW/MID/HIGH`, chroma max, lightness curve parameters) should live in a **single
source of truth** and be code-generated into TypeScript and WGSL to avoid drift.

### 8.1 Proposed Structure

```
packages/waveform-color/
├── constants.json          # Single source of truth
├── generated/
│   ├── constants.ts        # Generated TypeScript
│   └── constants.wgsl      # Generated WGSL
└── scripts/
    └── generate-constants.ts
```

### 8.2 Example `constants.json`

```json
{
  "bandVectors": {
    "low": {
      "a": 0.25,
      "b": 0.10
    },
    "mid": {
      "a": -0.20,
      "b": 0.10
    },
    "high": {
      "a": -0.05,
      "b": -0.25
    }
  },
  "chroma": {
    "boost": 1.2,
    "max": 0.4
  },
  "lightness": {
    "cpu": {
      "base": 0.5,
      "span": 0.4,
      "curve": "linear"
    },
    "gpu": {
      "base": 0.4,
      "span": 0.5,
      "curve": "sqrt"
    }
  }
}
```

Implementation is deferred, but having this in the spec gives permission to do it later instead of copy-paste.

---

## 9. Design Goals vs. Serato

### What "Beating Serato" Means

| Dimension               | Serato              | Dekzer Target                                |
|-------------------------|---------------------|----------------------------------------------|
| **Color space**         | sRGB-ish            | OKLab/OKLCH + Display P3                     |
| **Band mixing**         | HSL averaging       | Vector summation in (a,b) plane              |
| **Perceptual accuracy** | Energy ≠ brightness | L derived from total energy (by design)      |
| **Gamut**               | Limited             | Wide-gamut neon on capable displays          |
| **LOD consistency**     | Unknown             | Mathematically consistent across zoom levels |

### Visual Validation Criteria

1. **0.3s glance test:** Kick/snare/hats/vocals/pads distinguishable instantly
2. **Structure visibility:** Drops, breaks, outros obvious in both main waveform and overview strip
3. **Perceptual honesty:** Quiet-but-bright sounds don't look louder than dark-but-slamming ones
4. **Zoom stability:** No visual jumps when changing LOD levels

### AB Testing Protocol

Load same track in Dekzer + Serato, evaluate:

- Can I see the drop earlier in Dekzer?
- Can I distinguish claps vs snares vs rides better?
- Does the waveform "read" from 1m away?

Keep screenshots. Treat as formal visual regression tests.

### Validation Environment

A dedicated **Waveform Color Lab** page in the Dekzer/Seqlok playground will be the primary tuning and validation
environment for this spec. It should provide:

- Live sliders for all §7 tuning parameters
- Side-by-side comparison with reference tracks
- Screenshot export for visual regression testing

---

## 10. Future Extensions

### 10.1 Per-Band Lightness Weighting

Current: L determined purely by total energy, independent of band composition.

Future option: Mix full OKLab vectors `(L, a, b)` per band, allowing "bass-heavy content feels slightly darker than
treble-heavy at equal total energy."

### 10.2 Expanded Band Count

Current: 3 bands (low/mid/high).

Future: 4–6 bands for finer spectral resolution. Vector directions would need retuning to maintain perceptual
separation.

### 10.3 Semantic Overlays

Beyond color:

- Phase-coherent stem lanes (stacked or overlaid)
- Beatgrid/phrase/section boundaries via subtle geometry
- Ghost overlays for incoming deck / hotswap preview

---

## 11. References

- [Oklab color space - Wikipedia](https://en.wikipedia.org/wiki/Oklab_color_space)
- [oklch() - CSS Color 4 - MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch)
- [Canvas colorSpace - Stack Overflow](https://stackoverflow.com/questions/69274916/how-to-specify-color-space-for-canvas-in-javascript)
- [A perceptual color space for image processing - Björn Ottosson](https://bottosson.github.io/posts/oklab/) (original
  Oklab paper)
- [An interactive review of Oklab - Raph Levien](https://raphlinus.github.io/color/2021/01/18/oklab-critique.html) (
  uniformity analysis)
- [Serato Main Waveform Display](https://support.serato.com/hc/en-us/articles/224969307-Main-Waveform-Display) (
  reference for traditional DJ waveforms)
- [Why HSL/HSV are not perceptually uniform - CG Stack Exchange](https://computergraphics.stackexchange.com/questions/13118/why-are-the-hsl-and-hsv-color-models-not-considered-perceptually-uniform)

---

## Appendix A: Quick Reference

### CSS oklch() Syntax

```css
.class {
  /* L: 0–1, C: 0–~0.4, H: degrees */
  color: oklch(0.7 0.25 30);

  /* Percentage form (designer-friendly) */
  color: oklch(70% 62.5% 30deg); /* C: 0.4 = 100% */
}
```

### Band Vector Quick Reference

| Band         | Vector (a, b)  | Perceptual Color |
|--------------|----------------|------------------|
| Low (Bass)   | (0.25, 0.10)   | Red/Magenta      |
| Mid (Vocals) | (-0.20, 0.10)  | Green            |
| High (Air)   | (-0.05, -0.25) | Blue/Cyan        |

### Energy → Lightness Mapping

```
L = 0.5 + (energy × 0.4)

energy = 0.0  →  L = 0.50 (visible but dim)
energy = 0.5  →  L = 0.70 (medium)
energy = 1.0  →  L = 0.90 (bright, punchy)
```
