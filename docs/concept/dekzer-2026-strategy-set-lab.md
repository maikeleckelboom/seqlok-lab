# Dekzer 2026 Strategy: Set Lab

**Core thesis**: Dekzer wins by being AI-native (brain wired in) vs AI-washed (features bolted on)

**Internal lodestar**:
> "This is the only place where your set has a memory and a brain."

---

## 1. The Product: What V1 Actually Is

### 1.1 The Narrow Job

> **Dekzer v1 is the set lab for serious DJs.**

Constraints:

- Local/offline library (no streaming services)
- 1–2 decks (not 4)
- No "main-room PA ready" promise required
- Single core job: **Plan, rehearse, and iterate a 60–90 min set with Ghost guidance that learns your style**

### 1.2 Scope Cuts

| Cut                      | Rationale                                     |
|--------------------------|-----------------------------------------------|
| 4-deck live performance  | Trust earned in practice context first        |
| Streaming services       | Legal/ops nightmare, not core differentiation |
| Every controller mapping | Let incumbents own hardware breadth           |

### 1.3 Anti-Goals (Out of Scope for V1)

Explicit traps to avoid:

- **No streaming service integration** — not "we'll add Spotify quickly"
- **No "AI automix that promises full sets by itself"** — Ghost suggests, human decides
- **No controller zoo** — maybe one good mapping later, max
- **No mobile app** — browser PWA only
- **No "it works on every browser"** — Chromium-based only is fine for v1

### 1.4 Early Wins (thin, high-leverage)

| Win                                  | Why                                                                                     |
|--------------------------------------|-----------------------------------------------------------------------------------------|
| **CDJ/USB playlist export**          | Cheap to build once session log exists. Obvious bridge: "plan in Dekzer, play on CDJs." |
| **Rekordbox XML / Engine DB export** | Same logic. Immediate value before Dekzer is trusted for live sets.                     |

### 1.5 Success Criteria (End of 2026)

- [ ] 10–50 serious DJs using Dekzer regularly for practice/planning
- [ ] Each can articulate what Dekzer does that nothing else does
- [ ] Each can articulate where it sucks
- [ ] Each would miss it if taken away
- [ ] Ghost features actually shaping their decisions, not just a gimmick

---

## 2. Modes & Safety

Authority model for human vs AI control. These are invariants, not features.

### 2.1 Modes

| Mode         | Transport Authority | AI Capability                                    |
|--------------|---------------------|--------------------------------------------------|
| **Takeover** | Human               | Suggestions gated, require confirmation          |
| **Edit**     | Human               | AI can schedule future commands, staged not live |
| **Passive**  | Human               | Analyze/annotate only, cannot touch transport    |

### 2.2 Guardrails (encode as invariants)

- [ ] AI never stops a deck abruptly
- [ ] AI never jumps backward in time
- [ ] AI never changes tempo beyond ±X% without explicit confirmation
- [ ] All AI actions go through same validation as user commands

**Safety guarantee**:
> "If a human isn't allowed to do X outside the command API, the AI isn't either."

---

## 3. Architecture Invariants

These are timeless, not phase-gated.

### 3.1 Session Log Is the Spine

Everything AI sits on rich event logs. The log format from `ghost-dj-data-model.md`:

```typescript
interface CommandEvent {
  readonly tSeconds: number;       // derived: frameIndex / sessionSampleRate
  readonly frameIndex: number;     // canonical: integer frames since session start
  readonly command: GhostDjCommand;
}

// Metadata for logged events (wrap CommandEvent for persistence)
interface CommandEventMeta {
  readonly actor: 'human' | 'ghost' | 'system';
  readonly source?: 'ui' | 'midi' | 'script';
}

interface LoggedCommandEvent {
  readonly tSeconds: number;
  readonly frameIndex: number;
  readonly command: GhostDjCommand;
  readonly meta: CommandEventMeta;
}
```

*Why metadata?* Future analysis needs to know: was this human or AI? Did it come from MIDI or a macro script? Bake it in
now so logs are useful for Ghost and explainability later.

Requirements:

- [ ] Every deck action is a typed event
- [ ] Frame-accurate timestamps (not "roughly at 01:23")
- [ ] Serializable/deserializable (NDJSON)
- [ ] Deterministically replayable into engines
- [ ] Ready for vectorization AND classic analytics

### 3.2 Command Ring Is the Only Control Surface

**Invariant**: No UI code, no AI code directly mutates deck state.

- Everything expressed as commands into ring
- Processed sample-accurately
- Same validation for human and AI actors

### 3.3 Platform: Browser-First PWA

- Web Audio + AudioWorklets
- WebMIDI (later)
- File System Access API for local library
- Escape hatch: Electron/Tauri if browser becomes untenable for latency

---

## 4. Strategic Positioning (Evergreen Principles)

### 4.1 How Incumbents Use AI

| Feature                         | Reality                                    |
|---------------------------------|--------------------------------------------|
| Natural-language library search | Embeddings + vector DB, LLM parses prompt  |
| "Smart next track" panels       | Improved ranking, same architecture        |
| AI coach mode                   | LLM-generated tooltips/tutorials           |
| AI prep wizards                 | Batch analysis with prompt UI              |
| Smarter stems / mashup buttons  | Auto-stem, auto-align drops                |
| Chat assistant tab              | Lives next to mixer, not wired into engine |

**Key insight**: They bolt AI onto surfaces. Assistant lives *next to* the mixer, not *inside* it.

### 4.2 Dekzer's Structural Edges

| Edge                | What It Means                                                       | Why Incumbents Can't Copy Easily   |
|---------------------|---------------------------------------------------------------------|------------------------------------|
| **Data model**      | Sessions as rich event logs, not track checklists                   | Requires rewriting their DB schema |
| **Control surface** | Seqlok + command ring = deterministic, inspectable for human AND AI | They'd need new architecture       |
| **Brain split**     | On-device reflex + cloud reflection, designed as such               | They'll hack it on                 |
| **Explainability**  | Every decision tied to observable events                            | Their logs are thin                |

---

## 5. Vector Database Architecture

### 5.1 Reflex vs Reflection (Sacred Boundary)

```
REFLEX BRAIN (real-time)
  • Seqlok, hotswap, command rings, AudioWorklets
  • Hard real-time, sample budgets, no GC, no syscalls
  • NO vector DB queries here
        │
        │ pre-computed candidates, cached neighbors
        ▼
REFLECTION BRAIN (slow thinking)
  • SessionRecorder, Ghost DJ planner, suggestion engine
  • Vector DB queries (tens of ms acceptable)
  • Batch embeddings, similarity search
```

**Rule**: Vector DB is pure reflection layer. Never near the audio callback.

### 5.2 What Gets Embedded

| Entity      | V1-Critical? | Embeddings                                          | Use Case                           |
|-------------|--------------|-----------------------------------------------------|------------------------------------|
| **Track**   | ✓            | Audio (timbre, rhythm, density), text (title, tags) | Library search, "tracks like this" |
| **Segment** | ✓            | Intro, breakdown, drop, outro (coarse windows)      | Transition suggestions             |
| **Moment**  | ✓            | Current track + segment + coarse deck state         | "Have I been here before?"         |
| Stem        | Future       | Drum bus, bass, vocal, lead                         | Stem-aware suggestions             |

> **V1 simplicity rule**: For V1, "moment" can be brutally simple:
`{trackId, segmentKind, elapsedInSetMinutes, deckEnergyEstimate}`. Enrich later once the basic loop (log → suggest →
> act) is real.
> | FX/Riser/Impact | Future | Duration, brightness, character | "Impact like this but shorter" |
> | Macro/Action | Future | Text description + parameter curves | NL control, gesture recall |
> | Style | Future | Artist summary: pacing, energy curves | Personalization, set templates |

### 5.3 Hybrid Search (Mandatory)

Vector similarity alone produces nonsense.

```
Vector search (vibe)
  + Metadata filters (BPM, key, label, rights)
  + Scoring tweaks (preference model)
```

### 5.4 Guardrails

| Constraint                      | Reality                                       |
|---------------------------------|-----------------------------------------------|
| Embeddings ≠ full understanding | Space is weird for genres model never saw     |
| Latency budget                  | Few ms to tens of ms okay; batch/cache for UI |
| Pipeline complexity             | Ingest → embeddings (GPU) → index → caches    |

---

## 6. LLM Integration Strategy

### 6.1 LLMs as Compilers, Not Daemons

**Good**: Human intent → structured commands/plans
**Bad**: LLM in hot path, continuous network calls

**Hard guardrail**:
> "No LLM call is allowed to be required inside a sub-second interaction loop."

This means:

- No "next track suggestion" that blocks playback
- No UI that requires a completion to update knobs / critical state
- Cache and pre-ask in background; treat LLMs as "occasionally consulted expert," not "co-processor"

### 6.2 What's Required for V1?

**V1 (must)**: No LLM required. Ghost works with:

- Simple vector-based suggestions
- Session log + timeline
- Manual "Ghost markers" (good/bad moment flags)

**V1.5 (stretch)**: LLM becomes OP upgrade:

- Summarize sets
- Suggest alternate arcs
- Translate NL → command scripts

### 6.3 V1.5 LLM Use Cases

| Use Case                                        | Timing       |
|-------------------------------------------------|--------------|
| Compile transition description → command script | On request   |
| Summarize last night's set                      | Post-session |
| 3 alternate arcs for this crate                 | Planning     |
| What could have been done differently           | Post-session |
| Natural-language library search                 | On request   |

### 6.4 Audio Model Strategy

| Layer      | What Runs                 | When            |
|------------|---------------------------|-----------------|
| Reflex     | Nothing heavy             | During playback |
| Reflection | Stems, embeddings, lyrics | Offline/prep    |

---

## 7. Privacy & Cost

### 7.1 Privacy

- [ ] Local-first logging by default
- [ ] Explicit opt-in for cloud sync ("upload to Ghost Cloud for smarter planning")
- [ ] Audio stays local unless explicitly uploaded—we need decisions, not tracks
- [ ] No global model training without consent

### 7.2 Cost

- [ ] Identify free vs paid operations
- [ ] Batch to amortize LLM/embedding cost
- [ ] Cache aggressively (embeddings, neighbors)

---

## 8. Phased Roadmap

*Note: Targets are good-weather estimates. Ordering matters more than calendar.*

### Phase 1: Session Spine & One-Deck Lab

*Target: Q1 2026*

**Depends on**: Seqlok basic integration slice (single deck, EngineBank, command ring working end-to-end)

- [ ] One-deck browser lab tied to real engine(s)
- [ ] Session log format stable (NDJSON, frame-accurate)
- [ ] Deterministic replay working
- [ ] Basic timeline UI
- [ ] "Mark moment" affordances (manual good/bad flags)
- [ ] File System Access API for local library

### Phase 2: Two-Deck Lab + Hotswap Reality

*Target: Q2 2026*

**Depends on**: Signalsmith hotswap slice being boringly stable; Phase 1 complete

- [ ] Two decks + crossfader, all driven through command ring
- [ ] EngineBank + hotswap live in the lab (not just tests)
- [ ] Stable enough that you can practice full sets in it
- [ ] Session logs for entire sets

### Phase 3: Ghost Hints & Export

*Target: Q3 2026*

**Depends on**: Phase 2 complete; embedding pipeline exists (even if simple)

- [ ] Simple vector-based "next track" suggestions
- [ ] Vibe-similar search ("tracks like this")
- [ ] "Review last set" view:
  - [ ] Highlight marked moments
  - [ ] Show a couple of suggestions ("what else could fit here")
- [ ] Export playlists / cue maps to Rekordbox XML / Engine DB

### Phase 4: Closed Beta Set Lab

*Target: Q4 2026*

**Depends on**: Phase 3 complete; at least one real DJ (you) has used it for multiple full sets

- [ ] Onboard 10–30 serious DJs
- [ ] Tight feedback loop
- [ ] Optional: first LLM features (set summaries, NL transition → command sketch)

---

## 9. Open Questions

| Question                                  | Priority | Notes                                                  |
|-------------------------------------------|----------|--------------------------------------------------------|
| Session log schema freeze                 | P0       | Everything AI depends on it. Must lock before Phase 2. |
| Export format (Rekordbox XML / Engine DB) | P0       | Early win, enables "plan in Dekzer, play on CDJs"      |
| Vector DB choice (hosted vs self-hosted)  | P1       | Affects cost, latency, ops complexity                  |
| Embedding model selection                 | P1       | Quality of similarity, GPU cost                        |
| Controller support scope                  | P2       | Scope creep vs accessibility                           |
| Pricing model for beta                    | P2       | User acquisition vs runway                             |

---

## 10. Key Principles (Reference Card)

### Architecture

1. Session log is the spine—everything AI sits on rich event logs
2. Command ring is the only control surface—human and AI same API
3. Reflex vs reflection is sacred—vector DB never in audio callback
4. Browser-first until proven otherwise

### AI

1. V1 works without LLMs—LLMs are v1.5 upgrades
2. LLMs are compilers, not daemons
3. Explainability is a feature—every decision traces to observable events
4. Trust is earned in practice—suggestions gated, staged, inspectable

### Product

1. Narrow v1: set lab, not club replacement
2. 10–50 true fans > 10k users
3. Own the brain, not hardware breadth
4. Export interop is an early win, not a "not yet"

### Market

1. Users practice with AI, play shows with Rekordbox/USB
2. Incumbents have AI features; you have AI architecture

---

## 11. Alignment with Existing Specs

### Vector DB Domain Guide (`vector-db-domain-guide.md`)

Comprehensive reference for all vector/embedding work. See the **V1 Cut** section at the top for what's actually
required to ship.

For V1, only TrackVectors + brute-force search are required. Everything else (segments, moments, gestures) comes later.

Contents:

- **Geometry & embeddings**: Model selection, dimensionality, distance metrics
- **Indexes & databases**: ANN algorithms, product comparison, hybrid search
- **Pipelines & operations**: Ingestion, versioning, caching, privacy
- **Dekzer-specific domains**: Track/segment/stem, moment, gesture, crate spaces
- **Implementation roadmap**: 5-phase plan from brute-force to personalization

### Deck Audio MVP (`deck-audio-mvp.md`)

Companion spec defining "Traktor/Serato-class" audio behaviour:

- **Two playback paths**: Raw resample (keylock off, scratch) + Timestretch (keylock on)
- **Transport behaviour**: Tempo fader, scratch detection, seek handling
- **Discontinuity handling**: Micro crossfades for loops/jumps/cues
- **Acceptance checklist**: Must be green before Phase 3

### Ghost DJ Data Model (`ghost-dj-data-model.md`)

This strategy aligns with:

- **CommandEvent format**: `{ tSeconds, frameIndex, command }` as the atomic log unit
- **GhostDjCommand union**: typed deck + mixer commands
- **SessionState reconstruction**: derived offline from log + track features
- **Transition abstractions**: CrossfadeTransition, FilterGesture, EqGesture extracted post-hoc
- **Scaling phases**: matches Phase 1 (4–8 tracks), Phase 2 (20–50 tracks), Phase 3 (100–200 tracks)

### Seqlok DoD (`00-definition-of-done.md`)

This strategy depends on:

- **ARCH-1**: Layered monorepo stable (base → primitives → core → commands → hotswap → integration)
- **API-1**: Canonical flow final (defineSpec → planLayout → allocate → handoff → bind)
- **CONC-1**: Concurrency model documented (SWMR for params/meters, SWSR for command rings)
- **ERR-1**: Error domains split and stable

---

## 12. Next Actions

- [ ] Freeze session log schema (align with `ghost-dj-data-model.md`)
- [ ] Decide P0 questions (log schema, export format)
- [ ] Validate Phase 1 scope against current Seqlok state
- [ ] Share for feedback

---

*Document type: North Star Charter*
*Companion doc needed: "Q1/Q2 2026: what literally has to exist so a DJ can rehearse a set in Dekzer and not hate you"*
