# Seqlok Core Protocol: TLA+ Formal Specification

## What This Is

This is a **formal specification** of the seqlock-based coherence protocol used by `@seqlok/core` for params (
controller → processor) and meters (processor → controller/observer). The specification captures the SWMR (Single
Writer, Multiple Reader) model where:

- The **controller** thread writes params via scalar `set`, batch `update`, and array `stage` + commit operations; each
  completed write bumps a **LU** (Logical Unit) version exactly once.
- The **processor** thread (real-time audio) reads params within a **coherent window** (`params.within`) that sees
  either all-old or all-new values, never a torn mix; it writes meters via `publish`, bumping a **MU** (Meter Unit)
  version exactly once per call.
- **Observers** (main thread, UI) snapshot meters via seqlock retry until coherent.

The TLC model checker exhaustively explores every interleaving of writer and reader operations and verifies that safety
invariants (no torn snapshots, monotonic versions, exactly-once bumps) always hold and liveness properties (eventual
coherent snapshot, no infinite retry) are satisfied.

---

## Files (Proposed)

```
SeqlokCoreProtocol.tla   # The specification
SeqlokCoreProtocol.cfg   # Model checking configuration
test-vectors.json        # Conformance test traces
```

---

## Informal State Model

The TLA+ specification would track the following state variables:

### Params State

| Variable        | Domain                             | Description                                                                |
|-----------------|------------------------------------|----------------------------------------------------------------------------|
| `paramsScalars` | `[ParamKey → Value]`               | Committed scalar param values                                              |
| `paramsArrays`  | `[ArrayKey → Seq(Value)]`          | Committed array param values                                               |
| `paramsVersion` | `Nat` (LU counter)                 | Current seqlock version for params; even = stable, odd = write-in-progress |
| `stagingArrays` | `[ArrayKey → Seq(Value) ∪ {NULL}]` | In-flight staged array data (uncommitted)                                  |
| `stagingActive` | `BOOLEAN`                          | True if a `stage` block is open (uncommitted)                              |

### Meters State

| Variable              | Domain                             | Description                                                                |
|-----------------------|------------------------------------|----------------------------------------------------------------------------|
| `metersScalars`       | `[MeterKey → Value]`               | Committed scalar meter values                                              |
| `metersArrays`        | `[ArrayKey → Seq(Value)]`          | Committed array meter values                                               |
| `metersVersion`       | `Nat` (MU counter)                 | Current seqlock version for meters; even = stable, odd = write-in-progress |
| `publishActive`       | `BOOLEAN`                          | True if a `publish` block is open (uncommitted)                            |
| `meterStagingScalars` | `[MeterKey → Value ∪ {NULL}]`      | In-flight scalar meter values during publish (uncommitted)                 |
| `meterStagingArrays`  | `[ArrayKey → Seq(Value) ∪ {NULL}]` | In-flight staged array meter data during publish (uncommitted)             |

The meter state mirrors the param staging model: during a `publish` block, all writes (both scalar and array) accumulate
in staging state. Only when the publish block commits does the MU version bump once, atomically moving all staged values
to committed state.

### Reader State (for modeling snapshot attempts)

| Variable              | Domain                            | Description                                    |
|-----------------------|-----------------------------------|------------------------------------------------|
| `readerState`         | `{"idle", "reading", "retrying"}` | Current reader phase                           |
| `readerVersionBefore` | `Nat`                             | Version captured at snapshot start             |
| `readerBuffer`        | `[Key → Value ∪ {INCOMPLETE}]`    | Partial snapshot buffer                        |
| `retryCount`          | `Nat`                             | Number of retries (bounded for liveness proof) |

**Note on reader roles**: The spec models a single generic reader that can be instantiated in two concrete roles:

- **Param reader** (processor side): Uses `ProcessorWithin*` actions to read params coherently. In the real-time
  context, the processor does not retry on version mismatch — it simply uses stale data — but the model captures the
  coherence guarantee.
- **Meter observer** (controller/observer side): Uses `ObserverSnapshot*` actions to read meters. Observers may retry
  until a coherent snapshot is obtained.

This is a **reduced model** focusing on coherence semantics, not on every concrete API detail (e.g., how values are
surfaced to callbacks, or the exact retry policy).

---

## Actions / Next-state Operators

### Controller Actions (Params Writer)

| Action                                 | Variables Modified                                                | Constraints                                                                                           |
|----------------------------------------|-------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `ControllerSetParam(k, v)`             | `paramsScalars`, `paramsVersion`                                  | Scalar write: bumps version to odd, writes value, bumps to even. Atomic from model perspective.       |
| `ControllerUpdateParams(patch)`        | `paramsScalars`, `paramsVersion`                                  | Batch write: single version bump pair (odd → even) for entire patch. All-or-nothing commit semantics. |
| `ControllerStageArrayBegin(k)`         | `stagingActive`, `stagingArrays`                                  | Opens staging block for array `k`. Precondition: `stagingActive = FALSE`.                             |
| `ControllerStageArrayWrite(k, idx, v)` | `stagingArrays[k]`                                                | Mutates staging buffer. Only valid while `stagingActive = TRUE`.                                      |
| `ControllerStageArrayCommit`           | `paramsArrays`, `paramsVersion`, `stagingActive`, `stagingArrays` | Commits staged array, bumps LU exactly once, clears staging. Precondition: `stagingActive = TRUE`.    |
| `ControllerStageArrayAbort`            | `stagingActive`, `stagingArrays`                                  | Discards staging, no version bump. Precondition: `stagingActive = TRUE`.                              |

### Processor Actions (Params Reader, Meters Writer)

| Action                                   | Variables Modified                                                                                             | Constraints                                                                                                        |
|------------------------------------------|----------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `ProcessorWithinBegin`                   | `readerState`, `readerVersionBefore`                                                                           | Captures `paramsVersion` at window start. Precondition: version is even (stable).                                  |
| `ProcessorWithinRead(k)`                 | `readerBuffer`                                                                                                 | Copies param value to local buffer. Only valid while `readerState = "reading"`.                                    |
| `ProcessorWithinEnd`                     | `readerState`                                                                                                  | Validates `paramsVersion` unchanged. If mismatch, transitions to `"retrying"` (not modeled as real failure in RT). |
| `ProcessorPublishBegin`                  | `publishActive`, `metersVersion`                                                                               | Bumps `metersVersion` to odd, opens publish block. Precondition: `publishActive = FALSE`.                          |
| `ProcessorPublishScalar(k,v)`            | `meterStagingScalars`                                                                                          | Stages scalar meter value. Only valid while `publishActive = TRUE`. Does not bump version.                         |
| `ProcessorPublishArrayStage(k, mutator)` | `meterStagingArrays`                                                                                           | Stages array meter mutations via callback. Only valid while `publishActive = TRUE`. Does not bump version.         |
| `ProcessorPublishCommit`                 | `metersScalars`, `metersArrays`, `metersVersion`, `publishActive`, `meterStagingScalars`, `meterStagingArrays` | Commits all staged meter values, bumps `metersVersion` to even (exactly one MU bump), clears staging.              |

**Staging semantics for meters**: Inside a `publish` block, scalar writes via per-key writer functions and array writes
via `stage(key, cb)` both accumulate in staging state. The MU version is bumped **exactly once** when the publish block
commits, regardless of how many scalars or arrays were updated. This mirrors the param array staging model and ensures
observers see a coherent meter snapshot.

### Observer Actions (Meters Reader)

| Action                    | Variables Modified                   | Constraints                                                                 |
|---------------------------|--------------------------------------|-----------------------------------------------------------------------------|
| `ObserverSnapshotBegin`   | `readerState`, `readerVersionBefore` | Captures `metersVersion`. Transitions to `"reading"`.                       |
| `ObserverSnapshotRead(k)` | `readerBuffer`                       | Copies meter value. Only valid while `readerState = "reading"`.             |
| `ObserverSnapshotEnd`     | `readerState`, `retryCount`          | If `metersVersion` changed or was odd, retry. Otherwise, snapshot succeeds. |

---

## Safety Invariants

| Property                      | Meaning                                                                                                                  |
|-------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| `TypeOK`                      | All variables are in valid domains (versions non-negative, arrays bounded, flags boolean).                               |
| `VersionsEvenWhenStable`      | When no writer is active (`stagingActive = FALSE ∧ publishActive = FALSE`), versions are even.                           |
| `NoTornParamSnapshots`        | A completed `within` window sees a coherent generation: all values from before or after any single LU bump, never mixed. |
| `NoTornMeterSnapshots`        | A completed `snapshot` sees a coherent generation: all values from before or after any single MU bump.                   |
| `MonotoneParamsVersion`       | `paramsVersion` never decreases across transitions.                                                                      |
| `MonotoneMU`                  | `metersVersion` never decreases.                                                                                         |
| `StageCommitBumpsExactlyOnce` | Each `ControllerStageArrayCommit` increments `paramsVersion` by exactly 2 (odd → even cycle).                            |
| `PublishBumpsExactlyOnce`     | Each `ProcessorPublishCommit` increments `metersVersion` by exactly 2.                                                   |
| `SnapshotSeesCommittedOnly`   | Snapshot buffers never contain uncommitted staging data (param or meter).                                                |
| `NoNestedStaging`             | At most one param staging block is open at a time (`stagingActive` is exclusive).                                        |
| `NoNestedPublish`             | At most one meter publish block is open at a time (`publishActive` is exclusive).                                        |

### Staging constraints explained

The invariants `NoNestedStaging` and `NoNestedPublish` enforce that **at most one active staging context exists per side
** in this model:

- On the controller side: only one `stage(key, cb)` block can be open at a time.
- On the processor side: only one `publish(cb)` block can be open at a time.

This is a **spec simplification** for tractable reasoning. Real implementations may allow concurrent staging of
different arrays (in separate `stage` calls), but the coherence guarantees remain: each completed staging or publish
operation bumps the version exactly once, and snapshots never observe partially-staged data.

The invariant `SnapshotSeesCommittedOnly` is the key coherence property: it ensures that readers (whether `within` for
params or `snapshot` for meters) only observe values that have been fully committed. Staged-but-uncommitted data is
invisible to readers.

---

## Liveness Properties

| Property                      | Meaning                                                                                  |
|-------------------------------|------------------------------------------------------------------------------------------|
| `EventuallySnapshotSucceeds`  | A reader attempting a snapshot eventually obtains a coherent result.                     |
| `NoInfiniteRetryOnStableData` | If writers stop modifying data, readers do not retry forever.                            |
| `EventuallyPublishVisible`    | A committed meter publish eventually becomes observable to subsequent snapshots.         |
| `EventuallyParamVisible`      | A committed param write eventually becomes observable to subsequent `within` calls.      |
| `StagingEventuallyResolves`   | An opened staging or publish block eventually commits or aborts (no indefinite staging). |

### Liveness assumptions

The liveness properties above hold under the following assumptions:

1. **Writer quiescence or bounded activity**: Properties like `EventuallySnapshotSucceeds` and
   `NoInfiniteRetryOnStableData` assume that writers do not toggle versions indefinitely without making progress. In
   practice, this means:
  - Writers eventually commit or abort their staging/publish blocks.
  - Writers do not issue an unbounded stream of overlapping writes that keep the version odd forever.

2. **Weak fairness on reader actions**: Readers that are enabled (i.e., ready to attempt a snapshot) eventually get
   scheduled. This is a standard TLA+ fairness assumption (`WF_vars(ReaderActions)`).

3. **Weak fairness on writer commit actions**: Opened staging or publish blocks eventually commit or abort. This
   prevents writers from holding a block open indefinitely (`WF_vars(CommitActions)`).

4. **Bounded retry model**: For `NoInfiniteRetryOnStableData`, the model assumes a bounded `retryCount` or relies on the
   fact that once writers stop, the version stabilizes (even), allowing readers to succeed on the next attempt.

Under these assumptions:

- `EventuallySnapshotSucceeds` holds because a stable (even) version window eventually appears.
- `EventuallyPublishVisible` and `EventuallyParamVisible` hold because committed writes are immediately reflected in the
  committed state, and subsequent coherent reads see them.
- `StagingEventuallyResolves` holds by the fairness assumption on commit/abort actions.

---

## Relationship to Implementation

The TLA+ spec is the **source of truth** for the seqlock coherence protocol. TypeScript and Rust implementations must:

1. **Implement the same state transitions** — `set`, `update`, `stage`/commit, `within`, `publish`, `snapshot` map
   directly to spec actions.
2. **Maintain the invariants** — no torn reads, monotonic versions, exactly-once bumps.
3. **Use appropriate memory ordering** — TypeScript relies on `Atomics.load`/`store` with appropriate semantics;
   Rust/C++ use `atomic_thread_fence` or equivalent.
4. **Be testable via generated test-vectors** — TLC can export state traces that implementations replay to verify
   conformance.

The spec deliberately does **not** define:

- Memory layout (offsets, alignment, plane structure).
- Specific typed-array kinds (`Float32Array`, `Int32Array`, etc.).
- How the `within` callback receives values (copied vs view).

### Out of scope: range policy and value validation

The implementation supports a **range policy** for scalar params (`'clamp' | 'reject'`), but this spec does not model
it. The TLA+ spec treats all values as abstract but well-typed — if a value appears in a `set` or `update` action, it is
assumed valid.

This omission is intentional: range clamping/rejection is a **value-level concern** orthogonal to the coherence
protocol. The spec focuses on:

- Version bumps and their atomicity.
- Snapshot coherence (no torn reads).
- Staging/commit lifecycle.

Implementations must layer range validation on top of the coherence protocol, but the two concerns are independent.

Those are implementation details in `@seqlok/core` bindings.

---

## TLA+ Module Structure (Sketch)

```tla
---------------------------- MODULE SeqlokCoreProtocol ----------------------------
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
    PARAM_KEYS,           \* Set of scalar param keys
    ARRAY_PARAM_KEYS,     \* Set of array param keys
    METER_KEYS,           \* Set of scalar meter keys
    ARRAY_METER_KEYS,     \* Set of array meter keys
    MAX_ARRAY_LEN,        \* Maximum array length
    MAX_RETRY             \* Bounded retry for liveness proof

VARIABLES
    \* Params state
    paramsScalars, paramsArrays, paramsVersion,
    stagingArrays, stagingActive,
    \* Meters state (with staging)
    metersScalars, metersArrays, metersVersion,
    publishActive, meterStagingScalars, meterStagingArrays,
    \* Reader state
    readerState, readerVersionBefore, readerBuffer, retryCount

vars == << paramsScalars, paramsArrays, paramsVersion,
           stagingArrays, stagingActive,
           metersScalars, metersArrays, metersVersion,
           publishActive, meterStagingScalars, meterStagingArrays,
           readerState, readerVersionBefore, readerBuffer, retryCount >>

TypeOK == ...

Init == ...

\* Controller actions (params writer)
ControllerSetParam(k, v) == ...
ControllerUpdateParams(patch) == ...
ControllerStageArrayBegin(k) == ...
ControllerStageArrayWrite(k, idx, v) == ...
ControllerStageArrayCommit == ...
ControllerStageArrayAbort == ...

\* Processor actions (params reader, meters writer)
ProcessorWithinBegin == ...
ProcessorWithinRead(k) == ...
ProcessorWithinEnd == ...
ProcessorPublishBegin == ...
ProcessorPublishScalar(k, v) == ...       \* Stages to meterStagingScalars
ProcessorPublishArrayStage(k) == ...      \* Stages to meterStagingArrays
ProcessorPublishCommit == ...             \* Commits all staged, bumps MU once

\* Observer actions (meters reader)
ObserverSnapshotBegin == ...
ObserverSnapshotRead(k) == ...
ObserverSnapshotEnd == ...

Next == ...

\* Safety invariants
NoTornParamSnapshots == ...
NoTornMeterSnapshots == ...
MonotoneParamsVersion == ...
MonotoneMU == ...
StageCommitBumpsExactlyOnce == ...
PublishBumpsExactlyOnce == ...
SnapshotSeesCommittedOnly == ...
NoNestedStaging == stagingActive => ~stagingActive'  \* (simplified)
NoNestedPublish == publishActive => ~publishActive'  \* (simplified)

Safety == TypeOK /\ NoTornParamSnapshots /\ NoTornMeterSnapshots /\ ...

\* Liveness (under fairness assumptions)
Fairness == WF_vars(Next)
EventuallySnapshotSucceeds == ...
NoInfiniteRetryOnStableData == ...

Spec == Init /\ [][Next]_vars /\ Fairness

THEOREM Spec => []Safety
THEOREM Spec => EventuallySnapshotSucceeds
=============================================================================
```

---

## Test Vector Shape (Proposed)

```json
{
  "name": "scalar_set_then_within",
  "description": "Controller sets a scalar, processor reads it coherently",
  "initialState": {
    "paramsScalars": {
      "gain": 0.5
    },
    "paramsVersion": 0
  },
  "steps": [
    {
      "action": "ControllerSetParam",
      "args": {
        "key": "gain",
        "value": 0.8
      },
      "expectedState": {
        "paramsScalars": {
          "gain": 0.8
        },
        "paramsVersion": 2
      }
    },
    {
      "action": "ProcessorWithinBegin",
      "expectedReaderVersionBefore": 2
    },
    {
      "action": "ProcessorWithinRead",
      "args": {
        "key": "gain"
      },
      "expectedValue": 0.8
    },
    {
      "action": "ProcessorWithinEnd",
      "expectedSuccess": true
    }
  ],
  "invariants": [
    "NoTornParamSnapshots",
    "MonotoneParamsVersion",
    "VersionsEvenWhenStable"
  ]
}
```

```json
{
  "name": "array_stage_commit_coherent",
  "description": "Array staging commits atomically, single LU bump",
  "initialState": {
    "paramsArrays": {
      "eq": [
        0,
        0,
        0,
        0
      ]
    },
    "paramsVersion": 0,
    "stagingActive": false
  },
  "steps": [
    {
      "action": "ControllerStageArrayBegin",
      "args": {
        "key": "eq"
      }
    },
    {
      "action": "ControllerStageArrayWrite",
      "args": {
        "key": "eq",
        "index": 0,
        "value": 1.0
      }
    },
    {
      "action": "ControllerStageArrayWrite",
      "args": {
        "key": "eq",
        "index": 1,
        "value": 2.0
      }
    },
    {
      "action": "ControllerStageArrayCommit",
      "expectedState": {
        "paramsArrays": {
          "eq": [
            1.0,
            2.0,
            0,
            0
          ]
        },
        "paramsVersion": 2,
        "stagingActive": false
      },
      "comment": "Single LU bump for entire array commit"
    }
  ]
}
```

```json
{
  "name": "meter_publish_then_snapshot",
  "description": "Processor publishes meters, observer snapshots coherently",
  "initialState": {
    "metersScalars": {
      "rms": 0.0,
      "peak": 0.0
    },
    "metersVersion": 0
  },
  "steps": [
    {
      "action": "ProcessorPublishBegin",
      "expectedVersionAfter": 1,
      "comment": "Version odd during publish block"
    },
    {
      "action": "ProcessorPublishScalar",
      "args": {
        "key": "rms",
        "value": 0.25
      },
      "comment": "Staged, not yet committed"
    },
    {
      "action": "ProcessorPublishScalar",
      "args": {
        "key": "peak",
        "value": 0.9
      },
      "comment": "Staged, not yet committed"
    },
    {
      "action": "ProcessorPublishCommit",
      "expectedState": {
        "metersScalars": {
          "rms": 0.25,
          "peak": 0.9
        },
        "metersVersion": 2
      },
      "comment": "Single MU bump for entire publish block"
    },
    {
      "action": "ObserverSnapshotBegin",
      "expectedReaderVersionBefore": 2
    },
    {
      "action": "ObserverSnapshotRead",
      "args": {
        "keys": [
          "rms",
          "peak"
        ]
      },
      "expectedValues": {
        "rms": 0.25,
        "peak": 0.9
      }
    },
    {
      "action": "ObserverSnapshotEnd",
      "expectedSuccess": true
    }
  ]
}
```

---

## How to Run (Proposed)

### TLA+ Toolbox

1. Open `SeqlokCoreProtocol.tla`
2. Create a new model with small constant bounds (e.g., 2 param keys, array length 4, max retry 3)
3. Add invariants: `TypeOK`, `NoTornParamSnapshots`, `NoTornMeterSnapshots`, etc.
4. Add properties: `EventuallySnapshotSucceeds`, `NoInfiniteRetryOnStableData`
5. Run TLC

### Command Line

```bash
java -jar tla2tools.jar -config SeqlokCoreProtocol.cfg SeqlokCoreProtocol.tla
```

---

## Why This Matters for Real-Time Audio

In RT audio, torn reads are catastrophic: they produce audible clicks, pops, or wildly incorrect filter coefficients.
The seqlock protocol ensures:

- **Coherence**: Readers see a consistent generation of all params/meters.
- **Lock-free writes**: Writers (both controller and processor) never block.
- **Bounded reader retry**: Under reasonable write rates, readers converge quickly.

By formally specifying and model-checking the protocol, we have mathematical confidence that the **design** prevents
torn reads before writing implementation code.
