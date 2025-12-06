# Deck Hot-Swap Advanced Multi-Swap (Level 3 — Exploratory)

**Status:** Exploratory design (non-binding vision doc)  
**Date:** 2025-12-04  
**Depends on:** Level 2.5 (multi-swap sanity, Reject-While-Busy implemented)

---

## READ THIS FIRST

This document is a **parking lot for future fancy behavior**. Nothing here is:

- Required for v0.3.x
- Scheduled for implementation
- A constraint on current work

**Purpose:** Prevent Level 2.5 from accidentally smuggling Level 3 complexity through the side door.

**When this becomes "law":** After Level 2.5 is shipped, stable, and battle-tested in production.

---

## 1. Purpose

Level 3 explores **expressive**, higher-order swap behavior on a single deck:

- **Queued swaps** with automatic follow-up fades
- **Retarget/coalesce** semantics for "change my mind mid-fade"
- **Richer perceptual constraints** (how it *feels* to a DJ/ghost planner)
- **Extended invariants** for formal models (beyond "1 ticket, 2 engines")

This is explicitly **not** a commitment for v0.3.x. It's a catalog of behaviors we deliberately exclude from Level 2.5.

### Relationship to lower levels

```
Level 2: One swap is always sane
         ↓
Level 2.5: Many swaps in a row are sane (sequential + reject-while-busy)
         ↓
Level 3: Fancy swap patterns (queue, retarget) without melting the audio thread
```

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Allow a controller to express **intent streams**, not single tickets:
  - "Go A→B now, then B→C when that's done"
  - "Fade towards C instead of B; I changed my mind mid-fade"
- Maintain clear, testable invariants:
  - Bounded number of active engines per deck
  - No audio discontinuities on retarget/queue
  - No unbounded queue growth or "forgotten" tickets
- Keep the **RT surface simple**: `stepBlock` still just runs the current plan

### 2.2 Non-Goals (for Level 3)

- ❌ Cross-deck coordination (deck groups, bus-wide fades) → Level 4 territory
- ❌ "Infinite" ticket streams or complex scheduling languages → overkill
- ❌ Psychoacoustic optimality guarantees → research problem, not engineering spec
- ❌ Automatic "smart" behavior without explicit policy selection → too magical

**Keep Level 3 about:** explicit, opt-in, composable swap policies with clear contracts.

---

## 3. Feature Axis A: Queued Swaps

At Level 2.5, overlapping policy is **Reject While Busy** (one active ticket max).

Level 3 explores **Queue Until Idle** as an optional mode.

### 3.1 Queue semantics (L3-Q1)

**Basic contract:**

Each deck may hold:

- At most **one active ticket** (currently executing)
- At most **one queued ticket** (waiting for active to complete)

**New ticket arrival while busy:**

Policy choice (to be decided when implementing):

- **Option A (Overwrite):** New ticket replaces queued ticket (latest-wins)
- **Option B (Reject if queued):** New ticket rejected if queue slot occupied

**Key invariants:**

- Queued ticket must **not** affect:
  - Current `phase` (still follows active ticket's lifecycle)
  - Active engine gains (no crossfade interference)
  - Active ticket's completion (no early termination)
- When active ticket returns to `idle`:
  - Queued ticket is installed at a well-defined frame boundary
  - Starts a fresh `prewarm → crossfade → retire → idle` cycle
  - There exists at least one `idle` block between swaps (observable plateau)

### 3.2 Prewarm policy for queued tickets (L3-Q2)

**Two modes to consider:**

#### Mode 1: Strict 2-engine (v0.3.x-compatible baseline)

- Queued ticket **does not** prewarm early
- At most 2 engines active per deck, always
- Queued ticket begins prewarm only after active ticket retires

**Pros:**

- ✅ Preserves Level 2/2.5 "max 2 engines" invariant
- ✅ No RT budget surprises
- ✅ Simpler TLA+ model

**Cons:**

- ❌ Second fade might have perceptible "cold start" latency

---

#### Mode 2: 3-engine prewarm (experimental, Level 3+)

- Queued ticket **may** begin prewarm during tail of active crossfade
- Invariant becomes "at most 3 engines per deck"
- Only active during specific phase windows (not arbitrary)

**Example timeline:**

```
Active: A→B crossfade (frames 0-128)
Queued: B→C ticket waiting

Frame 64: Active crossfade is 50% complete
        → Queued ticket's C engine begins prewarm
        → Now running: A (fading out), B (fading in), C (prewarming)

Frame 128: Active swap completes, A retires
         → Now running: B (active), C (prewarming)

Frame 129: Queued ticket installs, begins its crossfade
         → Now running: B (fading out), C (fading in)
```

**Pros:**

- ✅ Smoother back-to-back transitions
- ✅ No perceptible "cold start" on second fade

**Cons:**

- ❌ Violates "max 2 engines" invariant
- ❌ Requires tighter RT budgeting (3 engines rendering)
- ❌ More complex TLA+ model (3-way state space)
- ❌ Potential for pathological cases (queue thrashing)

**Status:** Mark 3-engine prewarm as **experimental** until RT budget proven viable.

### 3.3 Open questions for queued swaps

- **Queue depth:** Always max 1 queued ticket? Or allow deeper queues (2-3)?
  - Deeper queues → more complex state, harder to reason about
  - Recommendation: Start with max 1, revisit if real use case emerges

- **Queue visibility:** Can controller query "is there a queued ticket"?
  - Useful for UI feedback ("next fade pending")
  - Adds observability surface area

- **Queue cancellation:** Can you cancel a queued ticket explicitly?
  - Or only via replacement/overwrite?

---

## 4. Feature Axis B: Retarget / Coalesce

Level 3 also explores **"change of mind" mid-fade** behavior.

**Scenario:**

1. A→B fade is in progress (crossfade phase)
2. Controller issues ticket to C **before** A→B finishes

**Question:** What should happen?

### 4.1 Retarget-to-latest (L3-R1)

**Behavior:**

- Treat current fade as a path towards "latest requested engine"
- Conceptually morph A→B into A→C (or B→C, depending on semantics)

**Constraints:**

- Gains must change **continuously** (no jumps)
- Audio must never "snap back" to an older engine
- Total energy must remain bounded (no gain > 1.0 + ε per engine)

**Implementation sketch:**

Becomes a piecewise-defined fade:

```
Frames 0-64:   Standard A→B segment (before retarget request)
Frames 64-128: Bend towards C with smooth curve
               - A continues fading out (or holds)
               - B adjusts trajectory (fade out or stabilize)
               - C fades in to reach 1.0 by frame 128
```

**Perceptual challenge:**

- How to define "smooth curve" mathematically?
- Equal-power? S-curve? Custom spline?
- What happens if B barely started fading in (retarget after 1 frame)?

**Status:** Requires research + user testing. Not for v0.3.x.

---

### 4.2 Cancel-and-restart (L3-R2)

**Simpler alternative:**

When new ticket arrives during A→B:

1. Optionally **shorten/abort** A→B at next block boundary
2. Start fresh A→C fade from *current* audio state

- "Current state" = whatever the gain coefficients were at abort point

**Pros:**

- ✅ Much simpler to specify and test
- ✅ Clear "early retire" semantics (controller-visible)
- ✅ No complex curve math

**Cons:**

- ❌ May produce slightly non-uniform perceived loudness
- ❌ "Wasted" partial fade (A→B never completes)
- ❌ Perceptible discontinuity if abort timing is unlucky

**Open question:**

- Should abort happen **immediately** (next block) or at **next safe point** (e.g. end of current crossfade segment)?

---

### 4.3 Comparison: R1 vs R2

| Aspect              | Retarget-to-latest (R1) | Cancel-and-restart (R2) |
|---------------------|-------------------------|-------------------------|
| Complexity          | High (curve math)       | Low (abort + restart)   |
| Smoothness          | Theoretically better    | May have discontinuity  |
| Testability         | Hard (define "smooth")  | Easy (abort = retire)   |
| Perceptual quality  | Unknown (needs testing) | "Good enough" likely    |
| Implementation risk | High                    | Low                     |

**Recommendation for Level 3 initial exploration:** Start with R2 (cancel-and-restart) as baseline, prove it works, then
consider R1 if user feedback demands it.

For a first implementation, Level 3 should treat **R2 (cancel-and-restart)** as the canonical retarget behavior. R1 (
continuous retarget) is research territory and should not be attempted until R2 is stable and well-understood.

---

### 4.4 Integration with queued swaps

**What if both features are enabled?**

Scenario: A→B active, C queued, D arrives mid-fade

Policy matrix:

| Retarget mode | Queue mode | Behavior                            |
|---------------|------------|-------------------------------------|
| None          | None       | Reject D (Level 2.5 baseline)       |
| R2 (cancel)   | None       | Abort A→B, start A→D, discard B     |
| None          | Queue      | Reject D (queue full with C)        |
| R2 (cancel)   | Queue      | Abort A→B, start A→D, queue stays C |
| R1 (retarget) | Queue      | Retarget A→B→D, queue stays C       |

**Conclusion:** These features **compose**, but the composition matrix is large. Level 3 should pick **one canonical
combo** (e.g. "R2 + Queue mode A") and test that thoroughly before supporting full matrix.

---

## 5. Perceptual & UX Constraints

Level 3 can start to talk about **"how it feels"** rather than just "is it mathematically valid".

### 5.1 Minimum fade durations

**Problem:** Rapid retargeting can produce "machine-gun" stuttering.

**Constraint ideas:**

- Minimum `fadeFrames` for retargeted fades (e.g. at 48 kHz, 32 frames ≈ 0.67 ms)
- Exponential backoff on retarget rate (first retarget = instant, subsequent = delayed)

**Status:** Design intent only; no concrete values proposed yet.

### 5.2 Maximum retarget rate

**Problem:** Controller spam could thrash the swap system.

**Constraint ideas:**

- Max N retargets per second per deck (e.g. 10 Hz)
- Reject/queue retargets that arrive "too fast"

**Implementation note:** This might be enforced at `scheduleSwap` layer, not RT layer.

### 5.3 Debouncing / hysteresis

**Problem:** Noisy controller input (e.g. LLM changing its mind every 100ms) creates poor UX.

**Possible solutions:**

- **Option A:** Build debouncing into `scheduleSwap`
  - Con: Policy decisions belong in controller, not runtime
- **Option B:** Provide debounce helper in SDK
  - Pro: Keeps runtime simple, gives controller explicit control

**Recommendation:** Option B (SDK helper), not runtime feature.

### 5.4 Curve families

**For retarget/crossfade quality:**

Consider offering a **curve plugin system**:

- Equal-power (default)
- Linear (for testing)
- S-curve (smooth perceptual fade)
- Custom (user-provided function)

**Status:** Out of scope for Level 3 spec; mention as "future extension point".

---

## 6. Extended Invariants & Modeling

Level 3 extends the invariants from Level 2.5.

### L3-I1: Bounded engines per deck

**Strict mode (v0.3.x-compatible):**

- At most **2 engines** active per deck at any time
- Active ticket's current + next only

**Experimental 3-engine mode:**

- At most **3 engines** active per deck at any time
- Active current + active next + queued prewarm

**TLA+ requirement:** Model must prove this bound under all Level 3 transitions.

---

### L3-I2: No ghost engines

**Invariant:**

Every audible engine at any time must be:

- The **current engine** of the active ticket, OR
- The **next engine** of the active ticket in a documented phase (`prewarm | crossfade`), OR
- The **prewarm engine** of a queued ticket (only in 3-engine mode, only during allowed windows)

**Anti-pattern:**

An engine C must never appear in decisions/audio if:

- No active or queued ticket references C as current or next, AND
- C is not explicitly in a prewarm window

**Test strategy:** Audit all `RecordedAudioBlock` entries; assert every non-zero gain corresponds to a known ticket's
engine.

---

### L3-I3: Retarget safety

**Gain bounds (test harness):**

For **strict 2-engine mode**:

- Per-engine gain ≤ 1.0 + ε
- Total gain across engines ≤ 2.0 + ε

For **experimental 3-engine prewarm mode**:

- Per-engine gain ≤ 1.0 + ε
- Total gain across engines stays within a documented bound
  (e.g. ≤ 2.5 + ε; exact value to be chosen when 3-engine mode is designed)

These are **test harness bounds** for constant engines (A=1, B=2, C=3), not psychoacoustic guarantees. For real music,
these bounds would likely be expressed in terms of RMS or LUFS, but the constant-engine harness uses simple amplitude
bounds for mathematical verifiability.

**Rationale:**

- Per-engine bound: prevents individual engine from "exploding"
- Total bound: prevents energy buildup during multi-way crossfades

---

### L3-I4: Queue stability

**Invariant:**

If a ticket is queued at frame F:

- It must eventually either:
  - Be installed (after active ticket retires), OR
  - Be explicitly replaced/cancelled (via policy), OR
  - Expire (if expiry is implemented)

**Anti-pattern:**

A queued ticket must never:

- Be "forgotten" (stays queued forever while active ticket loops)
- Be installed while active ticket is still non-idle
- Appear in audio/decisions before it's installed

---

### 6.5 TLA+ modeling scope

**For Level 3, the formal model must cover:**

- ✅ Queued ticket as explicit state (not just "pending command")
- ✅ Retarget/cancel transitions (R2 at minimum)
- ✅ L3-I1 through L3-I4 as safety properties
- ✅ Liveness: "every accepted ticket eventually completes or is explicitly cancelled"

**Still out of scope:**

- ❌ Cross-deck interactions → Level 4
- ❌ Full retarget curve math (R1) → research problem
- ❌ Perceptual quality metrics → not formally verifiable

**Status:** TLA+ updates are blocked until Level 2.5 model is proven correct.

---

## 7. Migration / Feature Flags

Level 3 behavior should be **opt-in**, not silently enabled.

### 7.1 Swap policy as explicit configuration

Each deck (or system) has a **swap policy** setting:

```ts
type SwapPolicy =
  | "reject-while-busy"      // Level 2.5 baseline
  | "queue-until-idle"       // Level 3, Queue mode
  | "retarget-latest"        // Level 3, Retarget mode (R1)
  | "cancel-and-restart"     // Level 3, Retarget mode (R2)

interface DeckConfig {
  swapPolicy: SwapPolicy;
  // ... other config
}
```

**Implementation status:**

Only `"reject-while-busy"` is expected to ship in v0.3.x.

The other policies are **names reserved for future work**, so that we don't have to bikeshed strings later. They appear
here as design space, not implemented features.

**Configuration surface:**

When implemented, this might be exposed via:

- Runtime config: `DeckConfig.swapPolicy` at deck creation
- Environment variable: `SEQLOK_SWAP_POLICY` for system-wide default
- Per-deck override: `deck.setSwapPolicy(policy)` (if dynamic switching is supported)

Exact API TBD when feature lands.

### 7.2 Policy discovery

Controllers should be able to:

- **Query** policy for a deck: `deck.getSwapPolicy()`
- **Request** a policy at deck construction (subject to runtime support)
- **Fallback** gracefully if unsupported policy requested

### 7.3 Compatibility guarantee

**Existing callers** that assume "reject while busy" must not see behavior change unless they:

- Explicitly opt into Level 3 policy, OR
- Deploy to a runtime that defaults to Level 3 (with clear migration notice)

**Recommendation:** Default stays `"reject-while-busy"` until Level 3 is battle-tested.

---

## 8. Open Questions (Level 3)

These are deliberately **unanswered** in this exploratory doc:

### Q1: Queue depth

- How many queued tickets per deck long-term?
- Current thinking: max 1 (single queue slot)
- Revisit if use case emerges for deeper queues (A→B→C→D chains)

### Q2: Ticket language

- Do we want a small **declarative ticket language** instead of imperative API?
  - Example: `deck.scheduleChain(["A→B", "B→C", "C→A"])`
- Or stay with ad-hoc `scheduleSwap` calls?
- Tradeoff: expressiveness vs. complexity

### Q3: Curve plugin system

- How much of retarget semantics is hard-coded vs. "curve plugin" territory?
- Should users provide custom crossfade curves?
- Or is built-in set (linear, equal-power, S-curve) sufficient?

### Q4: Cross-deck awareness

- Should Level 3 know about other decks (e.g. for bus-wide fades)?
- Or is that explicitly Level 4 (deck groups)?
- Current stance: Level 3 = single-deck only

### Q5: Real-world validation

- What DJ/Ghost DJ patterns actually need Level 3 features?
- Are we solving real problems or building "cool tech"?
- Recommend: user research before committing to implementation

---

## 9. Relationship to Level 2.5

**Clear boundary:**

| Aspect                  | Level 2.5              | Level 3                         |
|-------------------------|------------------------|---------------------------------|
| Active tickets per deck | Exactly 1              | 1 active + 0-1 queued           |
| Overlapping behavior    | Reject                 | Queue or Retarget               |
| Max engines             | 2                      | 2-3 (mode-dependent)            |
| Complexity              | "Is it correct?"       | "How fancy before brain melts?" |
| Status                  | **Shipping in v0.3.x** | **Exploratory only**            |

**Why this boundary matters:**

Level 2.5 is the **sanity layer**: it proves multi-swap isn't fundamentally broken.

Level 3 is the **UX layer**: it makes multi-swap feel good and powerful.

You can't do Level 3 until Level 2.5 is rock-solid in production.

---

## 10. Next Steps (When Level 2.5 is Done)

0. **Re-validate:** Confirm Level 2.5 is stable in production (logs, incidents, perf metrics)
1. **User research:** What swap patterns do real controllers need?
2. **Pick one feature:** Queue OR Retarget, not both initially
3. **Prototype:** Implement chosen feature as experimental flag
4. **Benchmark:** Prove RT budget works (especially for 3-engine mode)
5. **Test:** Extend engine-bank harness to cover Level 3 scenarios
6. **Model:** Update TLA+ spec to prove L3-I1 through L3-I4
7. **Document:** Convert this exploratory doc to ADR once feature lands

**Do NOT:**

- ❌ Start implementing Level 3 before Level 2.5 ships
- ❌ Mix Level 3 complexity into Level 2.5 PRs
- ❌ Promise Level 3 features to users without caveat

---

## 11. Summary

**Level 3 is fancy, not fundamental.**

It's parked here so we can:

- Reference it when someone asks "but what about retargeting?"
- Keep it out of Level 2.5 scope discussions
- Have a starting point when we're actually ready to build it

**The litmus test:** If you're debating whether something belongs in Level 2.5 or Level 3, ask:

> "Does a DJ using only sequential swaps (A→B, wait, B→C) need this?"

- If **yes** → Level 2.5
- If **no** → Level 3

That keeps Level 2.5 focused on "multi-swap sanity" and Level 3 focused on "multi-swap fancy".
