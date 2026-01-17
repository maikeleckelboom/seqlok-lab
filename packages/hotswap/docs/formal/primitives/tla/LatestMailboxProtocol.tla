---- MODULE LatestMailboxProtocol ----
(*
 * Formal specification of an SPSC "LatestMailbox" primitive.
 *
 * Purpose:
 *   - Single producer publishes high-rate intent updates (slider, target ratio, etc.).
 *   - Single consumer samples intent at RT cadence.
 *
 * Semantics:
 *   - Latest-wins overwrite: producer MAY overwrite an unread value.
 *   - Consumer MAY skip intermediate updates (coalescing).
 *   - No corruption / no phantom reads:
 *       * Consumer only reads values actually written by producer.
 *       * Each read returns the most recently written value at that moment.
 *   - Monotonic seqno allows consumer to detect missed updates.
 *
 * This is NOT a FIFO queue. It is a coalescing signal transport.
 *)

EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    MAX_SEQ,            \* Upper bound on seq for TLC state-space control
    MAX_STEP_INDEX,     \* Upper bound on steps for TLC exploration
    NoVal,              \* Distinguished "no value" marker
    V1, V2, V3          \* Small value domain for TLC

Values == {V1, V2, V3}

VARIABLES
    \* Mailbox state
    writesEnabled,      \* When FALSE, producer is quiescent (no further writes)
    hasVal,             \* Is there an unread value currently available?
    val,                \* The last written value (meaningful iff hasVal = TRUE)
    seq,                \* Monotonic write sequence number (0 at init)

    \* Consumer state
    lastReadSeq,        \* Sequence number last observed by consumer (0 at init)

    \* Progress / bounds
    stepIndex

vars ==
  << writesEnabled, hasVal, val, seq, lastReadSeq, stepIndex >>

TypeOK ==
    /\ writesEnabled \in BOOLEAN
    /\ hasVal \in BOOLEAN
    /\ val \in Values \cup {NoVal}
    /\ seq \in 0..MAX_SEQ
    /\ lastReadSeq \in 0..MAX_SEQ
    /\ stepIndex \in Nat

(*
 * Coherence invariants:
 * - seq never goes backwards
 * - lastReadSeq never exceeds seq
 * - if there is an unread value, it must be strictly newer than lastReadSeq
 *)
SeqCoherence ==
    /\ lastReadSeq <= seq
    /\ hasVal => (seq > lastReadSeq)
    /\ ~hasVal => TRUE

ValCoherence ==
    hasVal => (val \in Values)

WritesDisableMonotonic ==
    (writesEnabled = FALSE) => (writesEnabled' = FALSE)

Init ==
    /\ writesEnabled = TRUE
    /\ hasVal = FALSE
    /\ val = NoVal
    /\ seq = 0
    /\ lastReadSeq = 0
    /\ stepIndex = 0

(*
 * Producer writes a new intent update.
 * Overwrite is allowed: if hasVal is already TRUE, this replaces the unread value.
 *)
ProducerWrite(v) ==
    /\ writesEnabled = TRUE
    /\ v \in Values
    /\ seq < MAX_SEQ
    /\ seq' = seq + 1
    /\ val' = v
    /\ hasVal' = TRUE
    /\ UNCHANGED << writesEnabled, lastReadSeq >>
    /\ stepIndex' = stepIndex + 1

(*
 * Producer becomes quiescent: no more writes are possible after this.
 * This is how we model "producer stops spamming".
 *)
ProducerDisableWrites ==
    /\ writesEnabled = TRUE
    /\ writesEnabled' = FALSE
    /\ UNCHANGED << hasVal, val, seq, lastReadSeq >>
    /\ stepIndex' = stepIndex + 1

(*
 * Consumer reads the mailbox if a value is available.
 * Returns the latest written value at that moment (by construction: val).
 *)
ConsumerRead ==
    /\ hasVal = TRUE
    /\ hasVal' = FALSE
    /\ lastReadSeq' = seq
    /\ val' = val   \* value may remain in memory; logically "unread" flag clears it
    /\ UNCHANGED << writesEnabled, seq >>
    /\ stepIndex' = stepIndex + 1

(*
 * Idle step: models time passing where neither side acts.
 *)
StepIdle ==
    /\ UNCHANGED vars

Next ==
    \/ \E v \in Values : ProducerWrite(v)
    \/ ProducerDisableWrites
    \/ ConsumerRead
    \/ StepIdle

(*
 * Safety bundle.
 *)
Safety ==
    /\ TypeOK
    /\ SeqCoherence
    /\ ValCoherence

(*
 * Bounds for TLC.
 *)
StepBound ==
    stepIndex < MAX_STEP_INDEX

(*
 * Fairness: assume the system keeps taking enabled actions eventually.
 * (Same pattern as HotSwapSingle.)
 *)
Fairness == WF_vars(Next)

Spec ==
    Init /\ [][Next]_vars /\ Fairness

(*
 * Temporal properties:
 *)

SeqNeverDecreases ==
    [][seq' >= seq]_vars

ReadSeqNeverDecreases ==
    [][lastReadSeq' >= lastReadSeq]_vars

(*
 * Key liveness property (conditional on quiescence):
 * Once writes are disabled, the consumer eventually converges:
 *   - lastReadSeq catches up to seq
 *   - mailbox becomes empty (no unread value)
 *)
ConvergesAfterDisable ==
    [](writesEnabled = FALSE => <>(lastReadSeq = seq /\ hasVal = FALSE))

THEOREM Spec => []Safety
THEOREM Spec => SeqNeverDecreases
THEOREM Spec => ReadSeqNeverDecreases
THEOREM Spec => ConvergesAfterDisable

====

