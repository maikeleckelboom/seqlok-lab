---------------------------- MODULE HotSwapProtocol ----------------------------
(*
 * Formal specification of the @seqlok/hotswap protocol.
 *
 * This module specifies a lock-free hot-swap protocol for transitioning
 * between two "engines" in a real-time audio context, ensuring:
 *   - At most two engines are ever instantiated
 *   - No audio gaps during crossfade
 *   - Every accepted swap eventually completes
 *   - State transitions are deterministic
 *
 * The specification is implementation-agnostic: it describes the protocol,
 * not any particular TypeScript or C++ implementation.
 *)

EXTENDS Integers, Sequences, FiniteSets

\* ============================================================================
\* CONSTANTS - Parameters of the model (set in .cfg file)
\* ============================================================================

CONSTANTS
    MAX_PREWARM_BLOCKS,     \* Maximum prewarm blocks a ticket can request
    MAX_FADE_FRAMES,        \* Maximum crossfade length in frames
    BLOCK_FRAMES,           \* Frames per audio block (for fade decrement)
    MAX_STEP_INDEX          \* Upper bound on stepIndex for model checking

\* ============================================================================
\* PHASE ENUMERATION
\* ============================================================================

\* The six phases of the swap lifecycle
Phases == {"idle", "spawn", "prime", "prewarm", "crossfade", "retire"}

\* ============================================================================
\* STATE VARIABLES
\* ============================================================================

VARIABLES
    phase,                  \* Current phase of the protocol
    hasTicket,              \* Is there an active swap ticket?
    preWarmBlocksRemaining, \* Blocks left in prewarm phase
    fadeFramesRemaining,    \* Frames left in crossfade phase
    totalFadeFrames,        \* Total fade frames (for progress calculation)
    currentEngineActive,    \* Is the "current" engine slot occupied?
    nextEngineActive,       \* Is the "next" engine slot occupied?
    stepIndex               \* Monotonic step counter (for progress)

\* Tuple of all variables (for stuttering/fairness)
vars == <<phase, hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
          totalFadeFrames, currentEngineActive, nextEngineActive, stepIndex>>

\* ============================================================================
\* TYPE INVARIANT
\* ============================================================================

(*
 * TypeOK is the "type invariant" - it constrains variables to valid domains.
 * TLC checks this holds in every reachable state.
 *)
TypeOK ==
    /\ phase \in Phases
    /\ hasTicket \in BOOLEAN
    /\ preWarmBlocksRemaining \in 0..MAX_PREWARM_BLOCKS
    /\ fadeFramesRemaining \in 0..MAX_FADE_FRAMES
    /\ totalFadeFrames \in 0..MAX_FADE_FRAMES
    /\ currentEngineActive \in BOOLEAN
    /\ nextEngineActive \in BOOLEAN
    /\ stepIndex \in Nat

\* ============================================================================
\* INITIAL STATE
\* ============================================================================

(*
 * The system starts idle with one engine active.
 * This represents a running audio system before any swap is requested.
 *)
Init ==
    /\ phase = "idle"
    /\ hasTicket = FALSE
    /\ preWarmBlocksRemaining = 0
    /\ fadeFramesRemaining = 0
    /\ totalFadeFrames = 0
    /\ currentEngineActive = TRUE      \* We always have a current engine
    /\ nextEngineActive = FALSE        \* No next engine until swap begins
    /\ stepIndex = 0

\* ============================================================================
\* ACTIONS (State Transitions)
\* ============================================================================

(*
 * AcceptTicket: Host delivers a swap ticket while idle.
 *
 * Precondition: We're idle, no active ticket
 * Effect: Move to spawn phase, next engine is now instantiated
 *
 * This models the moment when:
 *   1. Host has constructed the next engine
 *   2. Host has delivered the ticket via SPSC queue
 *   3. RT thread accepts and begins the protocol
 *)
AcceptTicket(prewarm, fade) ==
    /\ phase = "idle"
    /\ hasTicket = FALSE
    /\ prewarm \in 0..MAX_PREWARM_BLOCKS
    /\ fade \in 1..MAX_FADE_FRAMES      \* Fade must be at least 1 frame
    /\ phase' = "spawn"
    /\ hasTicket' = TRUE
    /\ preWarmBlocksRemaining' = prewarm
    /\ fadeFramesRemaining' = fade
    /\ totalFadeFrames' = fade
    /\ nextEngineActive' = TRUE         \* Next engine now exists
    /\ currentEngineActive' = currentEngineActive  \* Unchanged
    /\ stepIndex' = stepIndex + 1

(*
 * StepSpawn: First block after ticket acceptance.
 *
 * In this phase:
 *   - Current engine processes normally
 *   - Next engine exists but hasn't processed yet
 *
 * Transition: spawn -> prime (always, after one block)
 *)
StepSpawn ==
    /\ phase = "spawn"
    /\ hasTicket = TRUE
    /\ phase' = "prime"
    /\ stepIndex' = stepIndex + 1
    \* Everything else unchanged
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                   totalFadeFrames, currentEngineActive, nextEngineActive>>

(*
 * StepPrime: Next engine's first process() call.
 *
 * In this phase:
 *   - Current engine processes normally (output goes to speakers)
 *   - Next engine runs its first block (output discarded)
 *
 * This lets the next engine initialize delay lines, filters, etc.
 *
 * Transition: prime -> prewarm (if prewarm > 0) or crossfade (if prewarm = 0)
 *)
StepPrime ==
    /\ phase = "prime"
    /\ hasTicket = TRUE
    /\ phase' = IF preWarmBlocksRemaining > 0 THEN "prewarm" ELSE "crossfade"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                   totalFadeFrames, currentEngineActive, nextEngineActive>>

(*
 * StepPrewarm: Warm up the next engine before crossfade.
 *
 * In this phase:
 *   - Current engine processes normally (output to speakers)
 *   - Next engine processes (output discarded)
 *
 * This allows time-domain effects (reverb tails, lookahead) to stabilize.
 *
 * Transition:
 *   - prewarm -> prewarm (decrement counter, if > 1 remaining)
 *   - prewarm -> crossfade (when counter hits 0)
 *)
StepPrewarm ==
    /\ phase = "prewarm"
    /\ hasTicket = TRUE
    /\ preWarmBlocksRemaining > 0
    /\ preWarmBlocksRemaining' = preWarmBlocksRemaining - 1
    /\ phase' = IF preWarmBlocksRemaining - 1 <= 0 THEN "crossfade" ELSE "prewarm"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, fadeFramesRemaining, totalFadeFrames,
                   currentEngineActive, nextEngineActive>>

(*
 * StepCrossfade: Both engines produce output, caller blends.
 *
 * In this phase:
 *   - Current engine processes (output weighted by fade-out curve)
 *   - Next engine processes (output weighted by fade-in curve)
 *   - Caller is responsible for the actual crossfade math
 *
 * The protocol just tracks frames remaining.
 *
 * Transition:
 *   - crossfade -> crossfade (decrement frames, if > blockFrames remaining)
 *   - crossfade -> retire (when frames hit 0)
 *)
StepCrossfade ==
    /\ phase = "crossfade"
    /\ hasTicket = TRUE
    /\ fadeFramesRemaining > 0
    /\ fadeFramesRemaining' =
        IF fadeFramesRemaining > BLOCK_FRAMES
        THEN fadeFramesRemaining - BLOCK_FRAMES
        ELSE 0
    /\ phase' = IF fadeFramesRemaining' <= 0 THEN "retire" ELSE "crossfade"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, totalFadeFrames,
                   currentEngineActive, nextEngineActive>>

(*
 * StepRetire: Crossfade complete, swap the engine handles.
 *
 * In this phase:
 *   - Next engine becomes current
 *   - Old current engine is released
 *   - Protocol returns to idle
 *
 * Memory barrier note (not modeled here):
 *   Caller must ensure all writes from retiring engine are visible
 *   before signaling deallocation to the host thread.
 *
 * Transition: retire -> idle (always)
 *)
StepRetire ==
    /\ phase = "retire"
    /\ hasTicket = TRUE
    /\ phase' = "idle"
    /\ hasTicket' = FALSE
    /\ preWarmBlocksRemaining' = 0
    /\ fadeFramesRemaining' = 0
    /\ totalFadeFrames' = 0
    \* The swap: next becomes current, next slot is now empty
    /\ currentEngineActive' = TRUE     \* Still have an engine (the new one)
    /\ nextEngineActive' = FALSE       \* Next slot now empty
    /\ stepIndex' = stepIndex + 1

(*
 * StepIdle: No-op when idle with no ticket.
 *
 * This represents audio blocks passing while no swap is pending.
 * The model needs this to avoid deadlock when exploring states.
 *)
StepIdle ==
    /\ phase = "idle"
    /\ hasTicket = FALSE
    /\ UNCHANGED vars

\* ============================================================================
\* NEXT-STATE RELATION
\* ============================================================================

(*
 * Next defines all possible transitions.
 * TLC will explore every sequence of these actions.
 *)
Next ==
    \/ \E prewarm \in 0..MAX_PREWARM_BLOCKS, fade \in 1..MAX_FADE_FRAMES :
        AcceptTicket(prewarm, fade)
    \/ StepSpawn
    \/ StepPrime
    \/ StepPrewarm
    \/ StepCrossfade
    \/ StepRetire
    \/ StepIdle

\* ============================================================================
\* SAFETY INVARIANTS
\* ============================================================================

(*
 * AtMostTwoEngines: Never more than two engines instantiated.
 *
 * This is critical for resource management: the slot abstraction
 * guarantees bounded memory usage.
 *)
AtMostTwoEngines ==
    \* At most one of {current, next} can be active beyond having a current
    \* Actually: current is always active, next is only active during swap
    /\ currentEngineActive = TRUE      \* Current always exists
    /\ (nextEngineActive = TRUE) => (phase # "idle")  \* Next only during swap

(*
 * NoGapDuringCrossfade: During crossfade, both engines must be active.
 *
 * If either engine were missing, the crossfade would have a gap
 * (silence or discontinuity).
 *)
NoGapDuringCrossfade ==
    (phase = "crossfade") => (currentEngineActive /\ nextEngineActive)

(*
 * NoOrphanedNextEngine: Next engine only exists when there's a ticket.
 *
 * This ensures we don't leak engine instances.
 *)
NoOrphanedNextEngine ==
    nextEngineActive => hasTicket

(*
 * PhaseTicketConsistency: Non-idle phases require a ticket.
 *)
PhaseTicketConsistency ==
    (phase # "idle") => hasTicket

(*
 * PrewarmOnlyInPrewarmPhase: Prewarm counter is only positive during prewarm.
 *
 * (Or during earlier phases that haven't reached prewarm yet)
 *)
PrewarmCounterConsistency ==
    (preWarmBlocksRemaining > 0) => (phase \in {"spawn", "prime", "prewarm"})

(*
 * FadeFramesConsistency: Fade frames tracking is sane.
 *)
FadeFramesConsistency ==
    /\ (fadeFramesRemaining > 0) => (phase \in {"spawn", "prime", "prewarm", "crossfade"})
    /\ fadeFramesRemaining <= totalFadeFrames

(*
 * Combined safety invariant
 *)
Safety ==
    /\ TypeOK
    /\ AtMostTwoEngines
    /\ NoGapDuringCrossfade
    /\ NoOrphanedNextEngine
    /\ PhaseTicketConsistency
    /\ PrewarmCounterConsistency
    /\ FadeFramesConsistency

\* ============================================================================
\* MODEL CHECKING BOUND (finite behaviors)
\* ============================================================================
(*
 * StepBound limits how many non-idle steps TLC can explore in a single
 * behavior. This is a model-checking convenience only: real implementations
 * are not required to enforce this bound. The .cfg file supplies the
 * MAX_STEP_INDEX constant.
 *)
StepBound ==
    stepIndex < MAX_STEP_INDEX

\* ============================================================================
\* LIVENESS PROPERTIES (Temporal)
\* ============================================================================

(*
 * Fairness: We assume the system keeps making progress.
 *
 * Weak fairness on Next means: if a transition is continuously enabled,
 * it will eventually be taken. This prevents the model checker from
 * finding "counterexamples" where the system just stops.
 *)
Fairness == WF_vars(Next)

(*
 * EventuallyIdle: Every swap eventually completes.
 *
 * If we're in a non-idle phase, we will eventually return to idle.
 * This is a liveness property: something good eventually happens.
 *
 * Written in temporal logic:
 *   [](phase # "idle" => <>(phase = "idle"))
 *
 * "Always: if not idle, then eventually idle"
 *)
EventuallyIdle == [](phase # "idle" => <>(phase = "idle"))

(*
 * ProgressMonotonic: stepIndex never decreases.
 *
 * This is actually a safety property (invariant over pairs of states),
 * but we express it as a temporal property for clarity.
 *)
ProgressNeverDecreases == [][stepIndex' >= stepIndex]_vars

(*
 * NoLivelock: We don't get stuck in prewarm or crossfade forever.
 *
 * If we enter prewarm, we eventually leave it.
 * If we enter crossfade, we eventually leave it.
 *)
NoLivelockPrewarm == [](phase = "prewarm" => <>(phase # "prewarm"))
NoLivelockCrossfade == [](phase = "crossfade" => <>(phase # "crossfade"))

(*
 * Full specification with fairness
 *)
Spec == Init /\ [][Next]_vars /\ Fairness

\* ============================================================================
\* THEOREMS (What TLC will verify)
\* ============================================================================

(*
 * The main theorem: Under the specification, safety always holds
 * and liveness properties are satisfied.
 *)
THEOREM Spec => []Safety
THEOREM Spec => EventuallyIdle
THEOREM Spec => ProgressNeverDecreases
THEOREM Spec => NoLivelockPrewarm
THEOREM Spec => NoLivelockCrossfade

=============================================================================
