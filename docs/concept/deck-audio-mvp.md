# Deck Audio MVP – "Same Class as Traktor/Serato"

**Goal**: Match the *behaviour class* of Traktor/Serato, not their exact DSP.

This is a companion spec to `dekzer-2026-strategy-set-lab.md`. It defines the minimum viable audio behaviour for a
Dekzer deck to feel "in the same universe" as modern DJ software.

---

## 0. Technical Background: How Traktor/Serato Actually Sound

Before defining what we're building, understand what we're matching.

### 0.1 What They Actually Use

- **Traktor Pro**: NI licensed **zplane élastique Pro v3** as their time-stretch/pitch engine. Same algo family used in
  many DAWs.
- **Serato DJ**: Uses Serato's own **Pitch 'n Time** algorithm for high-quality keylock.

Both are proprietary, but they're all in the same broad family: **phase-vocoder / hybrid time-stretch, heavily tuned for
DJ use**.

**Implication**: If you want *identical* behaviour, license Elastique or Pitch 'n Time. If you want *same kind of audio
effect*, implement the same technique family—which Signalsmith Stretch already is.

### 0.2 Algorithm Families

A DJ deck has three modes:

1. **Raw resample** (keylock off)

- Play at speed `r`, resample with high-quality interpolation
- Mathematically clean, "vinyl-correct": pitch goes up with tempo

2. **Time-stretch with pitch preservation** (keylock on)

- Maintain pitch, change tempo
- Needs real timestretcher: phase vocoder / WSOLA / granular hybrid

3. **Pitch-shift with tempo preservation** (key shift / key sync)

- Apply pitch shift after stretch

Modern "hi-fi" DJ engines use:

- **Phase vocoder + phase locking**: STFT → manipulate phase progression → resynthesize
- **Transient handling**: Shorter windows / modified processing around onsets
- **Psychoacoustic tuning** (Elastique-style): Multi-band / multi-resolution, per-band energy + envelope shaping

**Signalsmith Stretch is exactly "modern, phase-vocoder-with-good-tricks" territory.** Same species as Elastique.

### 0.3 How They Handle Faders, Keylock, Scratching

**Tempo fader, keylock off → pure resample:**

- Decode to fixed internal sample rate (44.1/48k)
- Maintain playhead in source frames
- Each callback: advance playhead by `r * blockFrames`, read with high-quality resampling
- No stretch, no phase vocoder → cleanest sound

**Tempo fader, keylock on → timestretcher:**

- Keep playback speed at 1.0 in stretcher's frame of reference
- Feed tempo fader value as time-scale ratio to stretcher
- At +6% tempo: source runs +6% faster, stretcher compresses by 1/1.06

**Scratching / jog wheel / DVS:**

- Serato: Keylock has scratch detection and **auto-disengages** for scratching
- Traktor: Similar—CPU goes wild if you scratch with keylock on
- Reason: Phase-vocoder stretch designed for smooth, slowly varying time-scale; vinyl scratching is fast, non-linear
  with reversals
- Pattern: Detect scratch mode → bypass keylock → use raw resample → re-enable on release

**Cue jumps, loops, beat jumps:**

- Tiny crossfades (few ms) between segments using constant-power fade (sin/cos)
- That's the "secret" behind click-free teleportation

---

## 1. Two Playback Paths per Deck

```ts
type TempoRatio = number; // 1.0 = original tempo

interface DeckRuntimeState {
  readonly tempoRatio: TempoRatio;
  readonly keylockEnabled: boolean;
  readonly transportMode: 'Normal' | 'Scratching' | 'Seeking';
}
```

### Path A – Raw Resample (Keylock Off + Scratch)

**Used when:**

- `keylockEnabled === false`, or
- `transportMode === 'Scratching'`

**Behaviour:**

- Internal fixed sample rate (e.g. 48 kHz)
- Playhead advanced by `tempoRatio * blockFrames`
- High-quality interpolation (polyphase FIR ideally; cubic allowed as stepping stone)

**Purpose:**

- Cleanest sound for:
  - pitch-following tempo changes
  - scratching
  - wild fader moves

### Path B – Timestretch (Keylock On)

**Used when:**

- `keylockEnabled === true` AND `transportMode === 'Normal'`

**Engine:**

- Signalsmith Stretch instance per deck
- `ratio` treated as a continuous param:
  - updated per block from `tempoRatio`
  - smoothed in processor (no hotswap)

**Presets:**

- At least one **DJ_NORMAL** preset tuned for:
  - stereo full-mix input
  - "clean zone" roughly −8%..+8%
- Optionally **DJ_EXTREME** for larger shifts with acceptable artifacts

**Invariant:**
> Heavy config changes (window size, quality mode, algorithm flags) **never** touch the live engine; they always go via
> spawn + prime + preWarm + crossFade in EngineBank.

---

## 2. Transport Behaviour

### 2.1 Tempo Fader

**Param:**

- UI tempo fader → `tempoRatio` param (e.g. 0.9–1.1 for ±10%)

**Processor:**

- Snapshot `tempoRatio` in `params.within`
- Apply smoothing over a short time constant (e.g. 10–50 ms) so wild UI moves don't cause zippering

**Routing per block:**

```ts
params.within((p) => {
  const s = p.deckA; // DeckRuntimeState snapshot
  switch (s.transportMode) {
    case 'Scratching':
      resampler.renderScratch(outBlock, s.tempoRatio);
      break;
    default: {
      if (s.keylockEnabled) {
        stretchEngine.setRatio(smoothed(s.tempoRatio));
        stretchEngine.render(outBlock);
      } else {
        resampler.render(outBlock, s.tempoRatio);
      }
    }
  }
});
```

### 2.2 Scratching / Jog

**Detection:**

- Controller/transport layer detects high-frequency, non-linear position changes:
  - large jog deltas
  - DVS timecode telling you "vinyl is grabbed"
- Sets `transportMode = 'Scratching'` while gesture is active

**Behaviour while `Scratching`:**

- Force **resample path**, regardless of keylock flag
- Keylock is conceptually "enabled", but implementation bypasses timestretch so scratches sound "natural vinyl"

**Release:**

- When scratch gesture ends:
  - Transition back to `transportMode = 'Normal'`
  - Re-enter timestretch path if `keylockEnabled === true`

This mirrors Serato/Traktor behaviour: keylock "seems" on, but scratch is always resampled.

### 2.3 Seek / Needle Search

**Edit Mode:**

- On pointer down: pause or gate audio, show ghost playhead
- Pointer move: move ghost only (no engine work)
- Pointer up:
  - Compute `targetFrame` from position
  - Emit a single `Seek` command:
    - In edit context, allowed to hard-seek engine to `targetFrame` and resume (no swap needed)

**Takeover Mode:**

- Scrub is either:
  - disabled, or
  - treated as a **single** discrete jump at gesture end:
    - `Seek` command with `targetFrame` + optional micro-fade
- Implementation can use:
  - safe internal seek on stretch engine if supported, or
  - a tiny spawn+crossFade hotswap at the new position

**Important:** seek/jump produces at most one engine change per gesture, **never** per pointer-move.

---

## 3. Discontinuities: Loops, Beat Jumps, Cue Jumps

**Goal:** No obvious clicks when teleporting within a track.

**Commands affected:**

- `SetLoopIn`, `SetLoopOut`, `SetLoopEnabled`
- `BeatJump{1,2,4,8}`
- `JumpToCue`
- etc.

**Implementation:**

- Deck engine applies a **micro crossFade** internal to the deck:
  - Fade length: 64–256 samples (1–5 ms) constant-power (sin/cos)
  - Fades out old region while fading in new region
- This can reuse existing A/B swap machinery or a tiny local crossfade buffer
- Requirements:
  - no discontinuity without a short fade
  - behaviour is deterministic and logged

---

## 4. Gain, Headroom, and Smoothing

To stay in "pro deck" territory:

### Headroom

- Internal deck path should assume at least 6 dB headroom:
  - Signalsmith output normalized accordingly
  - Resampler path aligned to same loudness
- Any deck/master limiter is **post-deck**, not inside the stretcher

### Param Smoothing

- Tempo ratio: short time constant (10–50 ms)
- Keylock toggles: crossFade between paths or at least one-block fade to avoid thunk

### Consistency

- Switching keylock on/off at static tempo should not audibly jump loudness or tone (beyond tiny stretch artefacts)

Capture this as quick bullets so you'll remember to check ear-feel, not just "no exceptions thrown."

---

## 5. Logging & Ghost Integration Hooks

Since Ghost cares about what kind of motion happened, extend `CommandEventMeta`:

```ts
interface CommandEventMeta {
  readonly actor: 'human' | 'ghost' | 'system';
  readonly source?: 'ui' | 'midi' | 'script';
  readonly transportMode?: 'Normal' | 'Scratching' | 'Seeking';
}
```

**Why:**

- Ghost later needs to know:
  - where you scratched
  - where you jumped
  - where you did smooth tempo rides vs brutal moves
- That's critical for learning your style, not just "you played these tracks"

---

## 6. Acceptance Checklist

Tick these before declaring "MVP deck audio is in the right class":

### Behaviour

- [ ] Keylock off: tempo changes & scratches sound clean, aliasing acceptable
- [ ] Keylock on: −8%..+8% range comparable (to your ears) to Traktor/Serato
- [ ] Fast tempo moves don't produce zipper noise or crazy pumping
- [ ] Loops, cue jumps, beat jumps are click-free at normal listening levels

### Routing

- [ ] Deck selects resample vs stretch path exactly as spec'd (keylock + transportMode)
- [ ] No live `.configure()`-style calls on the active Signalsmith engine
- [ ] All hard config changes use spawn+prime+preWarm+crossFade via EngineBank

### Playground

- [ ] Small test lab where you can:
  - [ ] load a loop
  - [ ] ride tempo
  - [ ] toggle keylock
  - [ ] scratch
  - [ ] do loops/jumps
  - [ ] and it feels "in the same universe" as a modern DJ deck

---

## 7. Relationship to Strategy Doc

This spec defines Phase 1/Phase 2 audio behaviour requirements:

- **Phase 1** (one-deck lab): Path A (resample) working, basic tempo control
- **Phase 2** (two-deck lab): Both paths working, keylock toggle, scratch detection, discontinuity handling

The acceptance checklist should be green before moving to Phase 3 (Ghost hints).

---

## 8. Seqlok Compatibility

Nothing here violates Seqlok invariants:

- Ratio is a **param**, updated via `params.set`, smoothed in processor
- "Hard" config changes (Signalsmith window/quality/etc.) go through spawn + prime + preWarm + crossFade (EngineBank +
  SwapTicket)
- Seek/jump/loop are **commands**: `ring.push({ op: 'BeatJump', deckId, frames, fadeFrames })`
- Deck engine turns commands into micro-fades or internal mini-hotswaps
