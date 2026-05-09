# From Pipe to Hub: Understanding Seqlok's Architecture

Welcome. You are looking at **Seqlok**, a high-performance library for sharing state between threads (like the Main Thread and a Physics Worker) without blocking the UI or creating garbage collection pauses.

To understand where we are today (**MWMR**), we must first understand the evolution of the system.

## The Evolution Timeline

```mermaid
flowchart LR
    subgraph Foundation[Phase 1: SWSR]
        F1[Single Writer]
        F2[Single Reader]
        F3[Seqlock Protocol]
    end

    subgraph Problem[Phase 2: Scaling]
        P1[Multiple Input Sources]
        P2[Race Conditions]
    end

    subgraph Solution[Phase 3: MWMR]
        S1[Ring Buffer Fan-In]
        S2[Hub Controller]
        S3[Observer Fan-Out]
    end

    Foundation --> Problem --> Solution

    %% Using a soft amber for a more neutral "Problem" state
    style Foundation fill:#C8E6C9
    style Problem fill:#FFECB3
    style Solution fill:#BBDEFB
```

---

## Phase 1: The Foundation (SWSR)

**"One writer holds the pen. Everyone else waits."**

At its core, Seqlok manages a block of **Shared Memory** (`SharedArrayBuffer`). Because two threads accessing the same memory at the same time causes chaos (race conditions), we established a strict **Single-Writer / Single-Reader (SWSR)** rule per domain.

### The Two Domains

We split the world into two lanes to avoid traffic jams:

1. **Params (Inputs):** The User changes a slider. Data flows **Controller → Processor**.
2. **Meters (Outputs):** The Engine reports a position. Data flows **Processor → Controller**.

### The Mechanism: The Seqlock

How do we read without locking the thread? We use a **Sequence Lock (Seqlock)**. This protocol ensures the audio/physics engine **never waits**. It just writes. The reader (UI) might have to retry, but the critical path never stops.

```mermaid
sequenceDiagram
    participant W as Writer (Processor)
    participant M as Shared Memory
    participant R as Reader (Controller)

    Note over W,R: Successful Write-Read Cycle
    W->>M: 1. Write Version (odd - v1)
    W->>M: 2. Write Data
    W->>M: 3. Write Version (even - v2)

    R->>M: 4. Read Version (v2) ✅
    R->>M: 5. Read Data
    R->>M: 6. Read Version Again (v2) ✅
    Note over R: Versions Match: Data Valid

    Note over W,R: Write During Read (Retry Case)
    W->>M: 1. Write Version (v3 - odd)
    R->>M: 2. Read Version (v2)
    W->>M: 3. Write Data / New Version (v4)
    R->>M: 4. Read Version Again (v4) ❌
    Note over R: Mismatch: Retry Read
```

---

## Phase 2: The Scaling Problem

**"What if we have more than one input?"**

The SWSR model works perfectly for `UI ↔ Audio`. But complex apps (like the Flocking Simulation or Dekzer) look like this:

- **Writers:** Mouse, MIDI Keyboard, Network Multiplayer, AI Script.
- **Readers:** React UI (DOM), WebGPU Visualizer (Canvas), Telemetry Logger.

If we let the MIDI worker and the Mouse write to the **Params** memory at the same time, they overwrite each other (**Corruption**). If the WebGPU thread reads while the Physics thread writes, it sees a "torn frame" (**Visual Glitches**).

We needed **Multi-Writer, Multi-Reader (MWMR)**.

---

## Phase 3: The Solution (System-Level MWMR)

**"The memory stays strict. The system becomes flexible."**

We realized we didn't need to change the low-level memory (which is fast because it is simple). We needed to change the **topology**.

### 1. Fan-In (Many Writers → One Hub)

To handle multiple inputs (MIDI, UI, AI), we don't let them touch the shared memory directly. Instead, they put **Commands** into a queue.

- **The Ring Primitive:** A lock-free circular buffer. It acts like a mailbox.
- **The Hub:** One specific thread (usually the Controller) acts as the "Hub." It opens the mailboxes, decides what to do, and is the **only one allowed to write** to the Params memory.

In Seqlok, fan-in is built from **SWSR rings**: each ring is still single-writer / single-reader, but the system uses many rings (one per writer or per channel) feeding into a single hub. The hub pulls from those rings and remains the **only writer** to the shared Params domain, so the memory itself never leaves SWSR.

**Result:** The memory still sees only one writer (The Hub), but the _system_ accepts inputs from everywhere.

```mermaid
flowchart LR
    subgraph Inputs [Multiple Writers]
        A[Mouse Input]
        B[MIDI Events]
        C[AI Script]
    end

    subgraph Ring [Lock-free Ring Buffer]
        direction TB
        R[Command Queue]
    end

    subgraph Hub [Single Hub Controller]
        H[Process Commands<br>Exclusive Memory Writer]
    end

    subgraph Memory [SWSR Memory]
        M[Params Domain]
    end

    A --> Ring
    B --> Ring
    C --> Ring
    Ring --> H
    H --> M

    %% Style Definitions using a soft, Material 3-inspired palette
    classDef input fill:#bbdefb
    classDef ring fill:#c8e6c9
    classDef hub fill:#a5d6a7
    classDef memory fill:#fff9c4

    %% Class Assignments
    class A,B,C input
    class Ring ring
    class H hub
    class M memory
```

### 2. Fan-Out (One State → Many Observers)

To handle multiple visualizations (UI, WebGPU), we introduced the **Observer**.

- **The Problem:** The Controller reads are "Best Effort" (lazy). Great for UI, bad for high-speed graphics which need 60 fps coherence.
- **The Observer:** A specialized **Hot Path** reader. It uses the Seqlock protocol strictly. It spins/retries until it gets a perfect frame.
- **Safety:** An Observer is **Read-Only**. You can spawn many of them. They never interfere with the physics engine.

In concrete terms, the Observer is wired using the `bindObserver` API: it binds into the same shared memory as the Controller and Processor, but exposes a read-only, hot-path-optimized view dedicated to visualizers and other consumers that need stricter coherence.

The difference between the **Cold Path** (UI) and **Hot Path** (Observer) is visualized below:

```mermaid
xychart-beta
    title "Performance: Cold Path vs Hot Path"
    x-axis ["Latency Tolerance", "GC Pressure", "Frame Coherence", "CPU Usage"]
    y-axis "Relative Intensity" 0 --> 10
    line [2, 8, 3, 2]
    line [8, 2, 9, 8]
```

> **Legend:** **Blue Line** = Cold Path (Controller), **Orange Line** = Hot Path (Observer)

### The Complete Architecture

When we combine Fan-In and Fan-Out, the full Seqlok architecture looks like this:

```mermaid
flowchart TD
    %% Writers Section
    subgraph Writers [Multiple Input Sources]
        W1[Mouse]
        W2[MIDI Keyboard]
        W3[AI Script]
    end

    %% Fan-In Mechanism
    subgraph FanIn [Fan-In]
        R1[Ring Buffer 1]
        R2[Ring Buffer 2]
        R3[Ring Buffer 3]
    end

    %% Core SWSR Memory
    subgraph Core [SWSR Memory Domains]
        P[Params Memory]
        M[Meters Memory]
    end

    %% Readers Section
    subgraph Readers [Multiple Consumers]
        O1[React UI<br>Cold Path]
        O2[WebGPU Visualizer<br>Observer Hot Path]
    end

    %% Processor
    P1[Processor<br>Physics Engine]

    %% Connections
    Writers --> FanIn
    FanIn --> H[Hub Controller]
    H --> P
    P --> P1
    P1 --> M
    M --> O1
    M --> O2

    classDef hub fill:#c8e6c9
    class H hub
```

---

## Summary: The Learning Curve

The key takeaway is that complexity is handled at the topology level, allowing the memory level to remain simple and fast.

| Concept        | Phase    | Explanation                                   | Use Case                               |
| :------------- | :------- | :-------------------------------------------- | :------------------------------------- |
| **Controller** | **SWSR** | The Boss. Writes rules (Params). Reads stats. | **Cold Path** (UI updates)             |
| **Processor**  | **SWSR** | The Engine. Calculates physics. Writes stats. | **Hot Path** (Real-time Audio/Physics) |
| **Ring**       | **MWMR** | The Mailbox. Lock-free fan-in.                | Command aggregation (MIDI/Net)         |
| **Observer**   | **MWMR** | The Camera. Takes perfect snapshots.          | **Hot Path** (GPU Rendering)           |

### The Golden Rule: System Topology vs Memory Access

**"MWMR exists only at the system topology level, never at the primitive/memory level."**

```mermaid
quadrantChart
    title "Access Pattern Matrix"
    x-axis "Low Flexibility" --> "High Flexibility"
    y-axis "Simple" --> "Complex"
    quadrant-1 "Complex System, Simple Memory"
    quadrant-2 "Simple Everywhere"
    quadrant-3 "Legacy Approach"
    quadrant-4 "Chaos (Avoid)"
    "Seqlok MWMR": [0.8, 0.2]
    "Traditional SWSR": [0.2, 0.2]
    "Unprotected Access": [0.9, 0.9]
```

### See Also

- **ADR-00Y – MWMR Architecture** – the normative design for rings, hub, and observer roles.
- **Onboarding: The Seqlok Mindset and Hot Path** – how the MWMR topology feels from a developer’s point of view.
