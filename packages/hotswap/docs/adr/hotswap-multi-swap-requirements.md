# Deck Hot-Swap Multi-Swap Requirements (Level 2.5)

**Status:** Draft specification for multi-swap behavior layer  
**Date:** 2025-12-04  
**Depends on:** Level 2 (single-swap correctness) — already passing

---

## Purpose

This document defines the requirements for **Level 2.5**: guaranteeing that multiple hot-swaps on a single deck behave
sanely and predictably.

Level 2 established that a **single** A→B swap is correct at both protocol and sample level.  
Level 2.5 extends this to:

- sequences of swaps (A→B→C), and
- overlapping swap *requests* (A→B while B→C is requested mid-fade).

**Core principle:** multiple swaps in a row must not turn the deck into a chaos goblin.

---

## 0. Prerequisites (Level 2 — Already Satisfied)

These must remain green before Level 2.5 can be considered complete. They are enforced by existing tests in:

- `deck.timeline.integration.test.ts`
- `deck.engine-bank.integration.test.ts` (single-swap cases)

**Important architectural note:**

Level 2.5 focuses on **deck + engine-bank semantics** where swaps are issued via `scheduleSwap` through a mailbox and
processed by the hotswap slot driver. This is distinct from the **pure timeline layer** which supports
cancel-by-replacement semantics for timeline commands in general.

The timeline layer (`processTimelineBlock`, `TimelineDriver`) can handle arbitrary command replacement patterns. Level
2.5 specifically addresses the **higher-level deck integration** where:

- Swaps are scheduled through `scheduleSwap` (not raw timeline commands)
- The mailbox + hotswap slot driver mediate the behavior
- Engine bank interactions produce actual audio

See **Section 10, Q4** for alignment considerations between these layers.

**Required invariants (Level 2):**

- ✅ Single A→B swap executes all phases correctly:  
  `idle → prewarm → crossfade → retire → idle`
- ✅ Crossfade gain envelope is smooth and monotonic across the fade window  
  (for test engines A = 1.0 → B = 2.0, envelope averages increase smoothly).
- ✅ Prewarm phase does not leak next-engine audio to output
  - Output during `prewarm` is indistinguishable from "current-only A".
- ✅ Same-engine swap (A→A) produces stable output at 1.0
  - Crossfade A→A yields samples ≈ 1.0 for the entire fade.
- ✅ "Missing engine" produces **bounded** output (no explosions)
  - With next engine missing, crossfade output stays in `(0.0, 1.0)` for the test engines:
    it never exceeds the current engine's level and never goes negative.
- ✅ Very short `fadeFrames` completes cleanly within block budget
  - Crossfade completes in ≤ 2 blocks and transitions clearly from "mostly A" to "mostly B".
- ✅ Zero-length segments produce no audio samples
  - Protocol may emit segments of `frames = 0`; those must not cause any samples to be rendered.

These are the foundation Level 2.5 builds on. If any of these regress, Level 2.5 is automatically broken.

---

## 1. Sequential Swaps (Requirement 2.5-S1) ✅

**Status:** PASSING  
**Test:**
`deck engine bank integration: higher-order swaps → "supports sequential swaps A→B→C without regressing engines"`

### 1.1 Scenario

The scenario is defined in terms of the test harness:

1. Deck starts on engine **A** (constant output 1.0).
2. We schedule and complete a swap **A→B**:

- Swap is installed at `atFrame = 0`.
- We call `runUntilSwapComplete(blockFrames, maxBlocks)` until the harness observes
  a full cycle back to `phase === "idle"`.

3. We then schedule and complete a swap **B→C**:

- Second ticket is scheduled at `atFrame = timeline.frame` (i.e. after the first swap is fully settled).
- Again, we run until the system returns to `phase === "idle"`.

The engines used in the test harness are:

```ts
EngineKind.A = 1.0;
EngineKind.B = 2.0;
EngineKind.C = 3.0;
```

These constant values are **test-only fixtures** used to make the crossfade math
directly observable; production engines are free to output arbitrary audio.

### 1.2 Required guarantees

The system **MUST** guarantee the following for this sequential pattern:

#### 2.5-S1.1 First swap completion (A→B)

After A→B completes (first `runUntilSwapComplete` returns):

* At least one `idle` block exists where:
  * `decision.status.activeEngineKind === EngineKind.B`
  * Audio samples are approximately 2.0 for the constant-engine harness:
    * Mean of that block is close to 2.0 within a small numerical tolerance
      (tests currently use `toBeCloseTo(2.0, 5)`; any future change must maintain a tight bound).

#### 2.5-S1.2 Second swap completion (B→C)

After B→C completes (second `runUntilSwapComplete` returns):

* At least one `idle` block exists where:
  * `decision.status.activeEngineKind === EngineKind.C`
  * Audio samples are ≈ 3.0 (same tolerance story as above).

#### 2.5-S1.3 Monotonic engine progression at idle

Once any `idle` block with `activeEngineKind === EngineKind.B` has appeared:

* **No later `idle` block** may have `activeEngineKind === EngineKind.A`.

In other words, for settled idle phases, engine identity is monotone A → B → C across this sequence.
You never "fall back" to A after the deck has idled on B.

### 1.3 Implementation notes

* The **sequential** requirement assumes that the second ticket is scheduled **at or after** the frame where the first
  swap has fully completed (i.e. after `runUntilSwapComplete`).
* The test harness treats the deck as a single logical engine pipeline:
  * It asserts on engine identity via `decision.status.activeEngineKind`.
  * It cross-checks identity against audio via constant engines (1/2/3).
* Other sequences (e.g. A→B→D→E) should satisfy the same "no regression of idle engine" pattern, but Level 2.5 enforces
  the A→B→C case specifically as a concrete witness.

---

## 2. Overlapping Swaps (Requirement 2.5-O1) ⏳

**Status:** OPEN — policy not yet chosen/implemented  
**Test:** currently skipped:  
`deck engine bank integration: higher-order swaps → "rejects overlapping swaps: second ticket to C never takes effect during A→B"`

### 2.1 Problem statement

What happens when:

1. Swap A→B is scheduled and enters `prewarm` or `crossfade`.
2. Before A→B completes (i.e. before the deck returns to `idle`), a **second ticket** B→C is scheduled on the **same
   deck**.

This is a real controller pattern: live UI or Ghost DJ logic may issue a new swap while the previous one is still in
flight. The runtime must have a clear, documented policy for this case.

For Level 2.5, we explicitly assume **at most one active ticket per deck** at any time.
Overlapping behavior is defined in terms of *requests* arriving while that single ticket
is in progress.

### 2.2 Policy choice (2.5-O1)

You must choose **exactly one** of the following behaviors for v0.3.x and make it a contract.

#### Option 1: Reject While Busy (recommended default for v0.3.x)

**Behavior:**

* While `decision.status.phase !== "idle"`, the deck is considered **swap-busy**.
* Any new swap ticket:
  * is either ignored, or
  * is rejected with a defined error / status code.
* Only when the deck returns to `idle` is a new ticket accepted.

**Invariants (for test engines A/B/C):**

During an in-flight A→B swap:

* No block may have `activeEngineKind === EngineKind.C`.
* No block may have `nextEngineKind === EngineKind.C`.
* Final idle state must be indistinguishable from a single A→B scenario:
  * idle engine = B,
  * idle audio ≈ 2.0.

**Existing skipped test encodes:**

```ts
const touchedC = recordedAudio.some((block) => {
  const status = block.decision.status;
  return (
    status.activeEngineKind === EngineKind.C ||
    status.nextEngineKind === EngineKind.C
  );
});

expect(touchedC).toBe(false);
```

**Tradeoffs:**

* ✅ Simple to implement and reason about.
* ✅ Makes it clear to callers that they need to respect a "busy" window.
* ❌ Controllers must handle "swap rejected while busy" and retry later.

---

#### Option 2: Queue Until Idle

**Behavior:**

* Second ticket is accepted but stored as **pending**.
* While a swap is active (`phase !== "idle"`), the pending ticket is *not* installed.
* Once the current swap returns to idle, the queued ticket is automatically installed.
* Only one queued ticket exists per deck; newer tickets overwrite the queued one.

**Invariants (conceptual):**

* C does **not** appear in any decision status until A→B has completed.
* There is at least one idle block with B-only output between A→B and B→C.
* Eventually, C becomes active and idle audio ≈ 3.0.

**Tradeoffs:**

* ✅ More "responsive" for user intent — swaps are accepted even while busy.
* ✅ Natural fit for UI/LLM controllers that may fire rapid updates.
* ❌ Requires explicit queue semantics and careful state handling.
* ❌ Must define what happens when commands keep overwriting the queued ticket.

---

#### Option 3: Retarget / Coalesce (deferred)

**Behavior (not for 2.5):**

* A→B in progress is **retargeted** to A→C or morphs into B→C mid-flight.
* Requires multi-target crossfade semantics and careful perception design.
* Probably belongs to a later "Level 3: expressive multi-target fades" milestone.

**Policy for Level 2.5:**  
Do **not** attempt coalescing for v0.3.x. Treat this as explicitly **out of scope** until simple overlapping behavior (
reject/queue) is stable and well-tested.

---

### 2.3 Action items for 2.5-O1

To close Requirement 2.5-O1:

1. **Decide** on the overlapping policy for v0.3.x (recommend "Reject While Busy").
2. **Implement** the policy in the appropriate layer:

* either in `scheduleSwap` (refuse to enqueue when busy), or
* in `HotswapSlotDriver` / installer logic (ignore second install while a ticket is active).

3. **Un-skip** the overlapping swap test (or adjust it to the chosen policy) and make it pass.
4. **Document** the chosen policy in `HOTSWAP_INTEGRATION.md` (see 2.5-D1).

Until then, overlapping semantics remain "implementation detail" and are not safe to rely on.

---

## 3. Test Harness Stability (Requirement 2.5-H)

### 2.5-H1: Canonical harness API ✅

**Status:** SATISFIED (but must remain stable)

`createDeckEngineHarness()` is the canonical integration harness for:

> mailbox → timeline → hotswap slot → engine bank → audio

For Level 2.5 it is now a **spec surface**, not just a test helper.

**Required capabilities:**

* Supports at least `EngineKind.A`, `EngineKind.B`, `EngineKind.C` with constant outputs:
  * A = 1.0, B = 2.0, C = 3.0.
* Exposes:
  * `recordedAudio: RecordedAudioBlock[]`  
    (per segment: samples + `SwapStepDecisionRT`).
  * `timeline.frame: number`  
    for scheduling subsequent swaps.
* Provides:
  * `runUntilSwapComplete(blockFrames, maxBlocks)`  
    that:
    * drives the timeline in block-sized steps, and
    * returns after the system has gone through a non-idle phase and back to `idle` again,
    * or exhausts `maxBlocks`.

**Commitment:**  
Future refactors must either preserve this harness API or update Level 2 / 2.5 docs and tests together. Randomly
breaking the harness is equivalent to breaking the spec.

---

### 2.5-H2: No zombie tickets / no engine regression ✅ (for current scenarios)

**Status:** SATISFIED for the current A→B / A→B→C tests.

This requirement is currently **witnessed** by concrete scenarios in the tests;
it is intended as a general contract for future sequences as the test matrix grows.

**Requirement:**

Across any finite sequence of swaps on a single deck:

* Every swap ticket must either:
  * run to completion (`prewarm → crossfade → retire → idle`), or
  * be cleanly rejected/ignored by the chosen overlapping policy.
* The final `idle` engine and audio must correspond to **the last successfully installed ticket**.
* There must be no "zombie" engine state: an engine that appears in decisions or audio
  despite not being the current or next engine of any active ticket.

**Enforcement today:**

* Single A→B tests verify "no zombie A after B".
* Sequential A→B→C test verifies:
  * there is an idle plateau with B,
  * then an idle plateau with C,
  * and no idle blocks regress to A after B has been observed.
* Once overlapping policy is implemented and its test is un-skipped, 2.5-H2 will also be enforced for
  overlapping-request scenarios (no ticket C "half-applied" if policy says reject / queue / etc.).

---

## 4. Documentation Coupling (Requirement 2.5-D1)

**Status:** TODO (blocked on 2.5-O1 policy decision)

### 2.5-D1.1 `HOTSWAP_INTEGRATION.md` updates

`HOTSWAP_INTEGRATION.md` should gain a section:

```md
## Multi-Swap Behavior

Sequential swaps on a single deck (for example A→B, then B→C) are supported.
Each swap is defined as:

- Install a ticket at a given `atFrame`
- Run through `prewarm → crossfade → retire → idle`
- Observe a settled idle phase under the new engine

This behavior is exercised in:

- `tests/deck.engine-bank.integration.test.ts`
  - "supports sequential swaps A→B→C without regressing engines"

### Overlapping Swaps

Policy: **[Reject While Busy / Queue Until Idle]**

When a swap is in progress (`phase !== "idle"`), new swap tickets are
[rejected / queued] on that deck, according to the chosen policy.

This behavior is specified and tested in:

- `tests/deck.engine-bank.integration.test.ts`
  - "rejects overlapping swaps: second ticket to C never takes effect during A→B"
```

### 2.5-D1.2 Requirements doc linkage

From `HOTSWAP_INTEGRATION.md`, link this file explicitly:

```md
For detailed multi-swap requirements and test specifications, see
[HOTSWAP_MULTI_SWAP_REQUIREMENTS.md](hotswap-multi-swap-requirements.md).
```

That makes this doc part of the canonical "what hot-swap is allowed to do" set.

---

## 5. Error Handling & Observability (Requirement 2.5-E)

**Status:** TODO (implementation detail for 2.5-O1)

### 2.5-E1: Swap rejection feedback

When the overlapping policy is "Reject While Busy", the system must provide **clear feedback** to callers.

**Proposed contract:**

`scheduleSwap` returns a status object instead of throwing:

```ts
interface SwapResult {
  readonly accepted: boolean;
  readonly reason?: "deck-busy" | "invalid-ticket" | "out-of-range" | "internal-error";
  readonly ticketId?: number;
}
```

For overlapping swaps under "Reject While Busy":

```ts
const result = scheduleSwap(config, ticket);
// result = { accepted: false, reason: "deck-busy" }
```

**Design constraint:**
Callers must be able to distinguish "rejected because busy" from "rejected because invalid ticket" without parsing error
messages or relying on exceptions.

### 2.5-E2: Diagnostic hooks

For debugging and monitoring multi-swap scenarios:

**Minimal status surface per deck:**

- Current phase (`idle | prewarm | crossfade | retire`)
- Active ticket ID (if any)
- Monotonically increasing "rejected swaps" counter

**Non-goal for v0.3.x:**
No `deck.isSwapBusy()` query API on the hot path. Prefer "fire `scheduleSwap`, check result" over check-then-act race
conditions.

---

## 6. Performance Constraints (Requirement 2.5-P)

**Status:** Intent documented; bench tests are TODO

### 2.5-P1: Sequential swap overhead

Running N sequential swaps (A→B→C→D...) must not:

- Accumulate memory leaks (ticket state must be cleaned up)
- Degrade block processing time
- Leave dangling timers or callbacks

**Future validation:**
10× sequential swap micro-benchmark should show final block processing time ≈ first block time (within measurement
noise).

### 2.5-P2: Overlapping rejection is O(1)

Rejecting an overlapping swap must:

- Happen **off the audio thread** (in `scheduleSwap` or installer layer)
- Be O(1) in both time and allocations
- Never block RT processing

**Implication:**
Rejection logic runs before the mailbox enqueue, not during `stepBlock`.

---

## 7. Compatibility (Requirement 2.5-C)

### 2.5-C1: Level 2 contracts remain unchanged

All Level 2 single-swap contracts remain valid:

- Existing code that schedules one swap at a time sees **no behavior change**
- No new failure modes for single-swap usage patterns
- Performance characteristics unchanged for one-swap-per-deck scenarios

### 2.5-C2: Opt-in complexity

Multi-swap behavior is **only** observable if:

- User explicitly schedules a second swap before the first completes (sequential or overlapping)
- Single-swap callers never encounter rejection/queue logic

**Migration story:**
"If you never overlapped swaps before, you're safe."

---

## 8. Formal Verification Coverage (Requirement 2.5-V)

**Status:** Scope defined; TLA+ model updates are TODO

### In scope for v0.3.x model:

The existing TLA+ specification must be extended to prove:

- **"At most 2 engines active per deck"** still holds under multi-swap scenarios
- Sequential A→B→C never regresses to A at idle
- Overlapping A→B + B→C under "Reject While Busy" never exposes C in any decision

### Out of scope (deferred to Level 3):

- Queue semantics (if Option 2 is ever chosen)
- Retarget/coalesce (Option 3)
- Cross-deck interactions (multi-deck coordination)

**Verification commitment:**
The model must prove the existing 2-engine invariant under Level 2.5 rules; anything beyond that is explicitly deferred.

---

## 9. Adoption Checklist (Requirement 2.5-A)

If you're already using hotswap in production:

### Before Level 2.5:

- [ ] **Audit call sites:** Do you ever call `scheduleSwap` twice on the same deck without waiting for idle?
- [ ] **Add telemetry:** Log when swaps are scheduled (timestamp, deck ID, ticket ID) to detect accidental overlaps
- [ ] **Review usage patterns:** Do you need sequential swaps (A→B→C) or only single swaps?

### After 2.5-O1 is implemented (with "Reject While Busy"):

- [ ] **Handle rejection status:** Check `result.accepted` and handle `reason: "deck-busy"` in UI/controller logic
- [ ] **Add monitoring:** Track swap rejection rate per deck as a health metric
  - High rejection rate → controller bug or UI spam
- [ ] **Update documentation:** Note that overlapping swaps are rejected until first swap completes

---

## 10. Open Design Questions (as of 2025-12-04)

### Q1: Per-deck or global rejection?

**Question:**
Should rejection be per-deck or global across all decks?

**Current assumption:**
Rejection is **per-deck**. Deck-0 can be busy while deck-1 accepts swaps. No global lock.

**Alternative:**
Global lock: simpler but more restrictive (one swap system-wide).

**Decision needed by:** 2.5-O1 implementation

---

### Q2: Prewarm during queue?

**Question:**
If "Queue Until Idle" policy is chosen: should the queued ticket start prewarming during the current swap's crossfade?

**Tradeoffs:**

- ✅ Pro: Smoother second transition
- ❌ Con: Now 3 engines active (violates TLA+ "at most 2 engines" invariant)

**Decision for v0.3.x:**
Queued tickets do **NOT** prewarm early. Prewarming a third engine explodes the state space and breaks the 2-engine
contract. This is **Level 3 territory**.

---

### Q3: Ticket expiry?

**Question:**
Can a ticket become "stale" if queued too long (or scheduled far in the future)?

**Current:**
No expiry mechanism. Tickets live until installed or replaced.

**Alternative:**
Add `ticket.expiresAtFrame` field for time-bound swaps.

**Decision:**
Not needed for Level 2.5. If queue spam becomes a real problem, revisit in Level 3.

---

### Q4: Align deck-level overlapping policy with timeline cancel-by-replacement?

**Question:**
The pure timeline layer (`deck.timeline.integration.test.ts`) already supports **cancel-by-replacement** semantics:
issuing a new swap can replace an in-flight one. This is mentioned in the Protocol Guarantees as "Cancellation via
replacement: Issue a new swap to cancel an in-flight one."

Level 2.5 proposes "Reject While Busy" at the **deck integration layer** (via `scheduleSwap` + mailbox + engine bank).
These are subtly different:

- **Timeline layer:** Supports arbitrary command replacement patterns (lower-level, general-purpose)
- **Deck layer:** Mediates swap requests through `scheduleSwap`, mailbox, and hotswap slot driver (higher-level
  integration)

**Current stance:**
These operate at **different abstraction levels**:

- Timeline cancel-by-replacement is a protocol capability (tested in timeline E2E)
- Deck overlapping policy is an integration-level decision (tested in engine-bank integration)

**Future alignment question:**
Should the deck layer eventually expose cancel-by-replacement (Option 3: "Retarget/Coalesce") to match the timeline
layer's capability? Or should the deck layer remain more conservative (reject/queue only) to simplify the programming
model for typical controllers?

**Decision:**
For v0.3.x, **keep them separate**:

- Timeline layer: retains cancel-by-replacement as a low-level capability
- Deck layer: starts with "Reject While Busy" as a simpler, safer default
- Future Level 3 work may unify or provide explicit mapping between the layers

---

## 11. Summary: What Must Be Done for Level 2.5

| Requirement                   | Status            | Blocking Issue                  |
|-------------------------------|-------------------|---------------------------------|
| **2.5-S1** Sequential swaps   | ✅ PASS            | None                            |
| **2.5-O1** Overlapping policy | ⏳ OPEN            | Policy not chosen / implemented |
| **2.5-H1** Harness API        | ✅ PASS            | Must keep stable                |
| **2.5-H2** No zombie tickets  | ✅ Partial (A→B→C) | Overlaps not validated yet      |
| **2.5-D1** Docs               | 📝 TODO           | Waiting on 2.5-O1               |

To declare **Level 2.5 complete**:

1. **Choose** overlapping swap policy (recommended: *Reject While Busy* for v0.3.x).
2. **Implement** that policy in runtime (installer / slot / scheduler).
3. **Un-skip** and pass the overlapping test in `deck.engine-bank.integration.test.ts`.
4. **Update documentation** (`HOTSWAP_INTEGRATION.md` + link this file).
5. Keep `createDeckEngineHarness` stable as the integration spec surface.

---

## Ultra-short summary

**Level 2 = "one swap is always sane."**  
**Level 2.5 = "many swaps in a row are still sane."**

Right now:

* Sequential A→B→C is already proven sane by tests and this doc.
* Overlapping A→B with a mid-fade B→C is written down as a **design decision you still need to make** and then encode in
  code + tests.
