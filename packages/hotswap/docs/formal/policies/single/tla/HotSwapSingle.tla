---- MODULE HotSwapSingle ----
(*
 * Formal specification of the @seqlok/hotswap protocol.
 *
 * This module specifies a lock-free hot-swap protocol for transitioning
 * between two engines in a real-time audio context, ensuring:
 *   - At most two engines are ever instantiated
 *   - No audio gaps during crossfade
 *   - Every accepted swap eventually completes
 *   - State transitions are deterministic
 *
 * The specification is implementation-agnostic: it describes the protocol,
 * not any particular TypeScript or C++ implementation.
 *)

EXTENDS Integers, Sequences, FiniteSets

(* Model parameters (set in .cfg) *)

CONSTANTS
    MAX_PREWARM_BLOCKS,     \* Maximum prewarm blocks a ticket can request
    MAX_FADE_FRAMES,        \* Maximum crossfade length in frames
    BLOCK_FRAMES,           \* Frames per audio block (for fade decrement)
    MAX_STEP_INDEX          \* Upper bound on stepIndex for model checking

(* Phase enumeration *)

\* The six phases of the swap lifecycle
Phases == {"idle", "spawn", "prime", "prewarm", "crossfade", "retire"}

(* State variables *)

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

(* Type invariant *)

(*
 * TypeOK constrains variables to valid domains.
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

(* Initial state *)

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

(* Actions (state transitions) *)

(*
 * AcceptTicket: Host delivers a swap ticket while idle.
 *
 * Precondition: idle, no active ticket.
 * Effect: enter spawn phase and instantiate the next engine.
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
    /\ currentEngineActive' = currentEngineActive
    /\ stepIndex' = stepIndex + 1

(*
 * StepSpawn: first block after ticket acceptance.
 *
 * Current engine runs; next engine exists but has not processed yet.
 * Transition: spawn -> prime.
 *)
StepSpawn ==
    /\ phase = "spawn"
    /\ hasTicket = TRUE
    /\ phase' = "prime"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                   totalFadeFrames, currentEngineActive, nextEngineActive>>

(*
 * StepPrime: next engine's first process() call.
 *
 * Current engine output goes to speakers; next engine output is discarded.
 * Transition: prime -> prewarm (if prewarm > 0) or crossfade (if prewarm = 0).
 *)
StepPrime ==
    /\ phase = "prime"
    /\ hasTicket = TRUE
    /\ phase' = IF preWarmBlocksRemaining > 0 THEN "prewarm" ELSE "crossfade"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                   totalFadeFrames, currentEngineActive, nextEngineActive>>

(*
 * StepPrewarm: warm up the next engine before crossfade.
 *
 * Current engine output goes to speakers; next engine output is discarded.
 * Transition:
 *   - prewarm -> prewarm (counter > 1)
 *   - prewarm -> crossfade (counter reaches 0).
 *)
StepPrewarm ==
    /\ phase = "prewarm"
    /\ hasTicket = TRUE
    /\ preWarmBlocksRemaining > 0
    /\ preWarmBlocksRemaining' = preWarmBlocksRemaining - 1
    /\ phase' =
        IF preWarmBlocksRemaining - 1 <= 0
        THEN "crossfade"
        ELSE "prewarm"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, fadeFramesRemaining, totalFadeFrames,
                   currentEngineActive, nextEngineActive>>

(*
 * StepCrossfade: both engines produce output; caller blends.
 *
 * The protocol tracks frames remaining; crossfade math is external.
 * Transition:
 *   - crossfade -> crossfade (frames remain)
 *   - crossfade -> retire (frames reach 0).
 *)
StepCrossfade ==
    /\ phase = "crossfade"
    /\ hasTicket = TRUE
    /\ fadeFramesRemaining > 0
    /\ fadeFramesRemaining' =
        IF fadeFramesRemaining > BLOCK_FRAMES
        THEN fadeFramesRemaining - BLOCK_FRAMES
        ELSE 0
    /\ phase' =
        IF fadeFramesRemaining' <= 0
        THEN "retire"
        ELSE "crossfade"
    /\ stepIndex' = stepIndex + 1
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, totalFadeFrames,
                   currentEngineActive, nextEngineActive>>

(*
 * StepRetire: crossfade complete, swap the engine handles.
 *
 * Next engine becomes current; old current is retired; protocol returns to idle.
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
    /\ currentEngineActive' = TRUE
    /\ nextEngineActive' = FALSE
    /\ stepIndex' = stepIndex + 1

(*
 * StepIdle: no-op when idle with no ticket.
 *
 * Represents audio blocks passing while no swap is pending.
 *)
StepIdle ==
    /\ phase = "idle"
    /\ hasTicket = FALSE
    /\ UNCHANGED vars

(* Next-state relation *)

(*
 * Next defines all allowed transitions.
 * TLC explores all behaviors built from these actions.
 *)
Next ==
    \/ \E prewarm \in 0..MAX_PREWARM_BLOCKS,
          fade \in 1..MAX_FADE_FRAMES :
        AcceptTicket(prewarm, fade)
    \/ StepSpawn
    \/ StepPrime
    \/ StepPrewarm
    \/ StepCrossfade
    \/ StepRetire
    \/ StepIdle

(* Safety invariants *)

(*
 * AtMostTwoEngines: never more than two engines instantiated.
 *)
AtMostTwoEngines ==
    /\ currentEngineActive = TRUE      \* Current always exists
    /\ (nextEngineActive = TRUE) => (phase # "idle")

(*
 * NoGapDuringCrossfade: during crossfade, both engines are active.
 *)
NoGapDuringCrossfade ==
    (phase = "crossfade") => (currentEngineActive /\ nextEngineActive)

(*
 * NoOrphanedNextEngine: next engine only exists when there's a ticket.
 *)
NoOrphanedNextEngine ==
    nextEngineActive => hasTicket

(*
 * PhaseTicketConsistency: non-idle phases require a ticket.
 *)
PhaseTicketConsistency ==
    (phase # "idle") => hasTicket

(*
 * PrewarmCounterConsistency: prewarm counter is only positive in early phases.
 *)
PrewarmCounterConsistency ==
    (preWarmBlocksRemaining > 0) =>
        (phase \in {"spawn", "prime", "prewarm"})

(*
 * FadeFramesConsistency: fade frame tracking is coherent.
 *)
FadeFramesConsistency ==
    /\ (fadeFramesRemaining > 0) =>
        (phase \in {"spawn", "prime", "prewarm", "crossfade"})
    /\ fadeFramesRemaining <= totalFadeFrames

(*
 * Combined safety invariant.
 *)
Safety ==
    /\ TypeOK
    /\ AtMostTwoEngines
    /\ NoGapDuringCrossfade
    /\ NoOrphanedNextEngine
    /\ PhaseTicketConsistency
    /\ PrewarmCounterConsistency
    /\ FadeFramesConsistency

(* Behavior bound (finite behaviors) *)

(*
 * StepBound limits how many steps TLC explores in a single behavior.
 * Real implementations are not required to enforce this bound.
 *)
StepBound ==
    stepIndex < MAX_STEP_INDEX

(* Liveness properties (temporal) *)

(*
 * Fairness: assume the system keeps making progress.
 *
 * Weak fairness on Next: if a transition is continuously enabled,
 * it will eventually be taken.
 *)
Fairness == WF_vars(Next)

(*
 * EventuallyIdle: every swap eventually completes.
 *
 * [](phase # "idle" => <>(phase = "idle"))
 *)
EventuallyIdle ==
    [](phase # "idle" => <>(phase = "idle"))

(*
 * ProgressNeverDecreases: stepIndex is monotonic.
 *)
ProgressNeverDecreases ==
    [][stepIndex' >= stepIndex]_vars

(*
 * NoLivelock: we don't get stuck in prewarm or crossfade forever.
 *)
NoLivelockPrewarm ==
    [](phase = "prewarm" => <>(phase # "prewarm"))

NoLivelockCrossfade ==
    [](phase = "crossfade" => <>(phase # "crossfade"))

(*
 * Full specification with fairness.
 *)
Spec ==
    Init /\ [][Next]_vars /\ Fairness

(* What TLC verifies *)

(*
 * Main theorems: under Spec, safety and liveness properties hold.
 *)
THEOREM Spec => []Safety
THEOREM Spec => EventuallyIdle
THEOREM Spec => ProgressNeverDecreases
THEOREM Spec => NoLivelockPrewarm
THEOREM Spec => NoLivelockCrossfade

====

