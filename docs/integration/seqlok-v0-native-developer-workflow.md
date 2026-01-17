# Seqlok V0 Native Developer Workflow

**Status:** Informative (non-normative)  
**Applies to:** Seqlok Integration Protocol V0  
**Audience:** C/C++/Rust/WASM DSP developers and kernel/integration implementers

This document describes the “day in the life” workflow for writing a guest DSP module against Seqlok V0. It is a usage
guide that sits *on top* of the normative V0 ABI + codegen specification.

---

## Mental model

Seqlok V0 makes the browser feel like an embedded target by exposing a strict ABI region with a versioned layout:

- **Params:** a block-stable snapshot written by the host before DSP runs
- **Audio planes:** fixed-size arrays (e.g. 128 frames) for audio-rate input/output
- **Meters:** a seqlock-protected surface written by the guest and read by the UI/host
- **Optional rings:** SPSC queues for sparse events/diagnostics (transport only)

The **kernel** owns scheduling and timing. The **guest** owns DSP. The ABI layout is derived from the Seqlok plan and is
validated by an ABI hash at mount time.

---

## 1) Header-driven integration (no manual bindings)

Instead of writing handwritten JS wrappers (`ccall` glue, JSON payload parsing, structured-clone types), the workflow
is:

1. **Define the contract** in TypeScript (`.surface.ts` / lane spec): params, meters, and cell regions (shape only).
2. **Generate ABI artifacts** with `seqlok-gen`:

- a lane header for the guest (`*_abi.h`)
- matching constants for the host (`*_abi.ts`)
- an ABI hash derived from a canonical binary encoding (layout + ranges + envelope version)

3. **Write the guest module**:

- include the generated header
- implement exports (`getAbiHash`, `init`, `tick(offset, frames)`, plus optional methods like `reset`)

The developer does **not** write offset math, alignment logic, or serialization code. The generated artifacts are the
single contract, and ABI drift is detected at mount time.

---

## 2) “Test-point” debugging via meters (bounded cost)

Seqlok meters are designed for high-frequency observability without allocating in the audio loop.

Typical pattern:

- Add a meter (e.g. `debug_phasor`, `env_follow`, `fft_bin_12`) to the surface.
- In the guest, publish it using the seqlock writer protocol.
- In the UI/host, read it with bounded-retry seqlock snapshots.

This behaves like an “oscilloscope probe point”: you can visualize internal DSP state without touching the audio stream.
It is not “free,” but the cost is bounded (a couple atomics plus payload stores) and suitable for realtime.

---

## 3) High-frequency control without serialization

Params in V0 are a **block-stable snapshot**:

- The host writes the snapshot once per block (or once per block and reuses it across slices).
- The guest treats it as immutable during `tick(...)`.

Because the host writes directly to a fixed offset region, you avoid the overhead and GC pressure of messaging JSON-like
objects across boundaries. This supports “lots of knobs” updates at control rate with predictable overhead.

Important constraint:

- **Block-rate control is not audio-rate modulation.**
  If you need smooth sample-by-sample modulation, generate it inside the DSP or provide an audio-rate input plane. Do
  not attempt to stream 44.1kHz updates via the param snapshot.

---

## 4) Sample-accurate actions via kernel slicing

In typical DSP code, “reset oscillator at sample N” forces every module to implement buffer splitting and tricky edge
logic.

In Seqlok V0, the guest stays slice-friendly:

- implement `tick(offset, frames)` and optional methods like `reset()`
- process exactly the frames you are asked to process

The kernel provides timing:

- it drains commands (from rings/mailboxes), validates them, schedules them against the frame clock,
- and slices the current block at command boundaries:

Example:

- `tick(0, 32)`
- `reset()`
- `tick(32, 96)`

The sample-accurate part is not magic in the guest — it’s a kernel responsibility. The benefit to guest authors is that
correct timing does not require bespoke math in every DSP module.

---

## 5) ABI drift fails fast (mount-time correctness)

Seqlok V0 uses an ABI hash so that layout drift fails immediately.

Typical failure mode prevented:

- guest header and host constants disagree on offsets/types/ranges
- without a hash, this can produce “works sometimes” corruption that shows up as random glitches later

With the hash:

- the lane refuses to mount when `getAbiHash()` differs from the host’s generated value

This does not make DSP bugs impossible (traps, numerical instability, infinite loops), but it removes a major class of
integration failures caused by mismatched layouts.

---

## Summary

To native developers, Seqlok V0 looks like a memory-mapped peripheral with explicit protocols:

- **Input:** block-stable param snapshot + audio planes
- **Output:** meters via seqlock (+ optional event rings)
- **Timing:** commands scheduled and applied by the kernel via slicing

The result is a workflow that feels like firmware against a BSP:

- deterministic layout from a single source of truth,
- strict ABI verification at mount time,
- and realtime-friendly primitives for control, observability, and event transport.
