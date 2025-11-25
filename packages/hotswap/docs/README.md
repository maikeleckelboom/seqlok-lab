# Hot-Swap Protocol: TLA+ Formal Specification

## What This Is

This is a **formal specification** of the `@seqlok/hotswap` protocol using TLA+ (Temporal Logic of Actions). Unlike code, which describes *how* to compute something, this specification describes *what* properties the system must satisfy.

The TLC model checker exhaustively explores every possible sequence of states and verifies that safety invariants always hold and liveness properties are eventually satisfied.

## Files

```
HotSwapProtocol.tla   # The specification
HotSwapProtocol.cfg   # Model checking configuration
```

## Properties We Prove

### Safety Invariants (must ALWAYS hold)

| Property | Meaning |
|----------|---------|
| `TypeOK` | All variables are in valid domains |
| `AtMostTwoEngines` | Never more than 2 engines instantiated |
| `NoGapDuringCrossfade` | Both engines active during crossfade (no audio gap) |
| `NoOrphanedNextEngine` | Next engine only exists when ticket is active |
| `PhaseTicketConsistency` | Non-idle phases require an active ticket |
| `PrewarmCounterConsistency` | Prewarm counter only positive in valid phases |
| `FadeFramesConsistency` | Fade frame tracking is sane |

### Liveness Properties (must EVENTUALLY hold)

| Property | Meaning |
|----------|---------|
| `EventuallyIdle` | Every swap eventually completes |
| `ProgressNeverDecreases` | `stepIndex` is monotonically non-decreasing |
| `NoLivelockPrewarm` | System doesn't get stuck in prewarm |
| `NoLivelockCrossfade` | System doesn't get stuck in crossfade |

## How to Run

### Option 1: TLA+ Toolbox (GUI)

1. Download [TLA+ Toolbox](https://lamport.azurewebsites.net/tla/toolbox.html)
2. File → Open Spec → Add New Spec
3. Select `HotSwapProtocol.tla`
4. TLC Model Checker → New Model
5. In "What is the behavior spec?": select `Spec`
6. Add invariants and properties from the lists above
7. Run

### Option 2: Command Line (tla2tools.jar)

```bash
# Download TLA+ tools
wget https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar

# Run model checker
java -jar tla2tools.jar -config HotSwapProtocol.cfg HotSwapProtocol.tla
```

### Option 3: VS Code Extension

1. Install "TLA+" extension by Alyssa-P-Hacker
2. Open `HotSwapProtocol.tla`
3. Use command palette: "TLA+: Check Model with TLC"

## Interpreting Results

### Success Output

```
Model checking completed. No error has been found.
  Checking 4 temporal properties...
  ...
  1234 states generated, 567 distinct states found, 0 states left on queue.
```

This means TLC explored all reachable states and found no violations.

### Failure Output

```
Error: Invariant AtMostTwoEngines is violated.
Error: The following behavior constitutes a counter-example:

State 1: <Initial predicate>
  phase = "idle"
  hasTicket = FALSE
  ...

State 2: <AcceptTicket(2, 4)>
  phase = "spawn"
  ...
```

TLC shows you the exact sequence of states that led to the violation. This is invaluable for debugging protocol design.

## Understanding the Spec

### State Machine Diagram

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
    ┌───────┐  AcceptTicket  ┌───────┐  step   ┌───────┐ │
    │ idle  │ ──────────────▶│ spawn │────────▶│ prime │ │
    └───────┘                └───────┘         └───────┘ │
        ▲                                          │     │
        │                               ┌──────────┴──────────┐
        │                               │                     │
        │                               ▼ (if prewarm > 0)    ▼ (if prewarm = 0)
        │                         ┌─────────┐           ┌───────────┐
        │                         │ prewarm │──────────▶│ crossfade │
        │                         └─────────┘           └───────────┘
        │                               │                     │
        │                               └─────────────────────┘
        │                                          │
        │                                          ▼
        │                                    ┌─────────┐
        └────────────────────────────────────│ retire  │
                                             └─────────┘
```

### Key Insight: What TLA+ Captures That Code Doesn't

The specification captures **all possible interleavings**. When you write:

```tla
AcceptTicket(prewarm, fade) ==
    /\ phase = "idle"
    /\ hasTicket = FALSE
    /\ prewarm \in 0..MAX_PREWARM_BLOCKS
    /\ fade \in 1..MAX_FADE_FRAMES
    ...
```

TLC will try AcceptTicket with *every* valid combination of `prewarm` and `fade`. It doesn't just test one path; it tests them all.

Similarly, the liveness property:

```tla
EventuallyIdle == [](phase # "idle" => <>(phase = "idle"))
```

is checked against *every possible infinite behavior* of the system. TLC proves this holds universally, not just for your test cases.

## Extending the Spec

### Adding Cancellation

To model mid-swap cancellation:

```tla
CancelSwap ==
    /\ phase \in {"spawn", "prime", "prewarm", "crossfade"}
    /\ hasTicket = TRUE
    /\ phase' = "retire"        \* Jump to cleanup
    /\ UNCHANGED <<hasTicket, preWarmBlocksRemaining, fadeFramesRemaining,
                   totalFadeFrames, currentEngineActive, nextEngineActive, stepIndex>>
```

Then add to `Next`:
```tla
Next ==
    \/ ...existing actions...
    \/ CancelSwap
```

### Adding Queued Swaps

To model accepting a new swap while one is in progress:

```tla
VARIABLES
    ...,
    pendingTicket       \* A ticket waiting to be processed

AcceptWhileBusy(prewarm, fade) ==
    /\ phase # "idle"
    /\ hasTicket = TRUE
    /\ pendingTicket = NULL     \* No existing pending
    /\ pendingTicket' = [prewarm |-> prewarm, fade |-> fade]
    /\ UNCHANGED <<phase, hasTicket, ...>>
```

Then modify `StepRetire` to check for pending tickets.

## Relationship to Implementation

The TLA+ spec is the **source of truth**. TypeScript and C++ implementations should:

1. Implement the same state transitions
2. Maintain the same invariants
3. Be testable against the same state sequences

You can export test vectors from TLC (state traces) and run them against both implementations to verify conformance.

## Further Reading

- [Lamport's TLA+ Home](https://lamport.azurewebsites.net/tla/tla.html)
- [Learn TLA+ (Practical Guide)](https://learntla.com/)
- [Specifying Systems (Free Book)](https://lamport.azurewebsites.net/tla/book.html)
- [Hillel Wayne's TLA+ Guide](https://www.hillelwayne.com/post/tla-messages/)

## Why This Matters for Real-Time Audio

In RT audio, bugs don't just cause crashes — they cause **audible glitches** that destroy user experience. The constraints are unforgiving:

- No allocation in the hot path
- No blocking
- Bounded, predictable execution time
- No race conditions or torn reads

By formally specifying the protocol and proving safety/liveness properties, we have mathematical confidence that the *design* is correct before writing a single line of implementation code.

The implementation can still have bugs (wrong array index, off-by-one, etc.), but the **protocol structure** is proven sound.
