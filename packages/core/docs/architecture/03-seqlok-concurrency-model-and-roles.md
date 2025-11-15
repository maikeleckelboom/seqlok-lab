# Seqlok: Concurrency Model & Roles

> _How Seqlok coordinates Controllers, Processors, and shared memory._

This document describes **who is allowed to touch what**, **how Seqlok uses seqlocks**, and **what is actually
guaranteed** when you call things like `within`, `publish`, and `snapshot`.

It's the canonical reference for "what does this library promise, and under which conditions?".

---

## High-Level Model

Seqlok organizes shared state into two **domains**:

- **Params** – control inputs flowing **from Controller → Processor**
- **Meters** – telemetry outputs flowing **from Processor → Controller**

Each domain is:

- Stored in **shared memory** (`SharedArrayBuffer` or shared `WebAssembly.Memory`)
- Guarded by its own **seqlock** (sequence lock)
- Accessed under strict **SWMR** (Single-Writer / Multiple-Reader) rules

On top of that, Seqlok defines three **roles**:

```text
Controller:
  - writes params
  - reads meters

Processor:
  - reads params
  - writes meters

Consumers:
  - read meters (via Controller or aggregators)
```

If you remember only one thing:

> **Controller owns inputs, Processor owns outputs, and everyone else is read-only.**

---

## Roles

### Controller

The **Controller** typically lives on the main thread (browser) or a host thread (Node):

- Writes to **params**
- Reads from **meters**
- Never writes meters
- Never uses `within` / `publish` (those are Processor-only)

Example (golden flow up to the Controller binding):

```ts
const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

const controller = bindController(spec, backing);

// controller responsibilities:
controller.params.set('gain', 0.8);
controller.params.update({ cutoff: 1200, resonance: 0.7 });

const meters = controller.meters.snapshot();
console.log(meters.peak, meters.rms);
```

Conceptually, the Controller is **“the human’s hand on the device”**: UI, automation, DAW host, etc.

---

### Processor

The **Processor** lives in a Worker, AudioWorklet, Wasm-backed engine, or some other engine-like context:

- Reads **params** using `within`
- Writes **meters** using `publish` (and `stage` for array meters)
- Never writes params
- Never reads meters by poking the backing directly

Example (engine-side binding already constructed via `receiveHandoff` → `bindProcessor`):

```ts
class MyProcessor {
  constructor(private readonly proc: ProcessorBinding<typeof spec>) {}

  process(input: Float32Array[], output: Float32Array[]): boolean {
    this.proc.params.within((params) => {
      const { gain, cutoff } = params;

      const result = this.dsp.process(input, output, gain, cutoff);

      this.proc.meters.publish((m) => {
        m.peak(result.peak);
        m.rms(result.rms);

        m.stage('spectrum', (buf) => {
          buf.set(result.spectrum); // array meter updated atomically
        });
      });
    });

    return true;
  }
}
```

The Processor is **“the device brain”**: runs tight loops, does DSP / simulation, and must obey real-time constraints.

---

### Consumers

**Consumers** are anything that reads meters but doesn’t own params or meters:

- UI graphs
- Logging/metrics jobs
- Secondary workers doing analysis

They should:

- Use **controller-facing APIs** (`controller.meters.snapshot()` or higher-level wrappers)
- Never attempt to write into the Seqlok backing directly
- Treat Seqlok as _source-of-truth telemetry_, not as mutable state

Example:

```ts
// projection by keys
const { peak, rms } = controller.meters.snapshot(['peak', 'rms']);

drawMeterUI({ peak, rms });
```

---

## Domains and Planes

Seqlok has two logical domains, each backed by several **planes** in memory.

### Param Domain

- **Scalar planes**: e.g. `PF32`, `PI32`, `PB` (floats, ints/enums, booleans)
- **Control plane**: `PU` (param control)

  - Contains seqlock counters for params: `LOCK_P`, `SEQ_P`
  - May hold additional meta indices

### Meter Domain

- **Scalar planes**: `MF32`, `MF64`, `MU32`, etc.
- **Control plane**: `MU` (meter control)

  - Contains seqlock counters for meters: `LOCK_M`, `SEQ_M`
  - May hold additional meta indices

Each domain has:

- One **writer** (Controller for params, Processor for meters)
- Zero or more **readers**
- Exactly one **seqlock** for coherence of that domain

There is **no single cross-domain seqlock**. Params and meters are separate, each with its own versioning and locking
discipline.

---

## Param Flow (Controller → Processor)

### Controller: Writes

The Controller updates param values through a high-level API that hides Atomics:

```ts
// single-field write
controller.params.set('gain', 0.7);

// multi-field write (batch)
controller.params.update({
  gain: 0.9,
  cutoff: 1500,
});

// staged array update (atomic commit for array param)
controller.params.stage('bands', (view) => {
  for (let i = 0; i < view.length; i++) {
    view[i] = computeBandValue(i);
  }
});
```

Under the hood, the param writer:

1. Begins a param write epoch:

- marks the param `LOCK_P` as "writing" (odd value).

2. Writes the relevant scalar and array values into their planes.
3. Ends the epoch:

- sets `LOCK_P` back to "quiescent" (even value), and
- bumps `SEQ_P` to indicate a new logical version.

The Controller is free to call `set` / `update` / `stage` at any time; the seqlock ensures readers either see the **old**
state or the **new** state, but never an in-between mix.

---

### Processor: Reads via `within`

On the Processor side, **all coherent param reads** go through:

```ts
proc.params.within((params) => {
  // params is a snapshot for the duration of this callback
});
```

Semantics:

- `within(cb)`:

  - Uses the param seqlock (`LOCK_P`, `SEQ_P`) to obtain a **coherent view**.
  - Retries internally if the Controller is mid-write.
  - Passes `cb` a `params` view where:

    - **Scalars** are captured values (`number`, `boolean`, string enums).
    - **Arrays** are scratch views scoped to this callback (e.g. `Readonly<Float32Array>`-like).

The callback is **synchronous**:

- You must not `await` inside `within`.
- You must not retain references to the `params` object or its array views for later use.

**Contract:** Treat the `params` view as living exactly for the duration of that callback.

---

### Param Invariants

With correct usage:

- Each call to `within` sees a param snapshot that corresponds to a single Controller state (for some `SEQ_P`).
- Snapshots are **monotonic** in version:

  - later calls to `within` see equal or greater `SEQ_P`, never older.

- No `within` callback sees a mix of two different writes; at worst it spins and retries until one is stable.

Seqlok does **not**:

- Guarantee that every single intermediate `update` is visible to the Processor.
- Guarantee any specific "age" of the snapshot, only that it is coherent.

---

## Meter Flow (Processor → Controller)

### Processor: Writes via `publish` and `stage`

On the Processor side, all meter writes go through:

```ts
proc.meters.publish((m) => {
  m.peak(result.peak);
  m.rms(result.rms);

  m.stage('spectrum', (buf) => {
    buf.set(result.spectrum);
  });
});
```

Semantics:

- `publish(cb)`:

  - Begins a meter write epoch (using `LOCK_M`).
  - Provides a **mutable writer** `m` where:

    - Scalar meters are functions: `m.peak(value)`, `m.rms(value)`, etc.
    - Array meters are written via `m.stage('key', cb(view))`:

      - the `view` is a scratch array view for that meter;
      - you usually do a single `view.set(...)` or a tight loop.

  - Ends the epoch by:

    - marking `LOCK_M` as quiescent, and
    - bumping `SEQ_M` to a new version number.

Multiple `publish` calls per audio quantum are **allowed**. Each one represents an atomic “meter commit” from the
Controller's point of view.

For example:

```ts
proc.params.within((params) => {
  const filtered = this.filter.process(input, params.cutoff);

  // first commit
  proc.meters.publish((m) => {
    m.filterOutRms(this.analyze(filtered));
  });

  const driven = this.drive.process(filtered, params.drive);

  // second commit
  proc.meters.publish((m) => {
    m.finalOutRms(this.analyze(driven));
  });

  return driven;
});
```

Each `publish` creates a distinct meter snapshot; both are **derived from the same param snapshot** captured by
`within`.

---

### Controller: Reads via `snapshot`

On the Controller side, all coherent meter reads go through `snapshot`:

```ts
// full snapshot
const allMeters = controller.meters.snapshot();
drawFullHud(allMeters);

// projection by keys
const { peak, rms } = controller.meters.snapshot(['peak', 'rms']);
drawCompactHud(peak, rms);

// reuse existing arrays for array meters (no allocations)
const buffers = {
  spectrum: new Float32Array(2048),
};

function frame() {
  const { spectrum } = controller.meters.snapshot(['spectrum'], {
    into: buffers,
  });

  drawSpectrum(spectrum);
  requestAnimationFrame(frame);
}

frame();
```

Semantics:

- `snapshot()`:

  - Uses the meter seqlock (`LOCK_M`, `SEQ_M`) to read a coherent view.
  - Retries internally if the Processor is mid-write.
  - Returns an object with all meter scalars and arrays (arrays are copies unless you use `into`).

- `snapshot(keys, options?)`:

  - `keys`: array of meter names (e.g. `['peak', 'rms']`).
  - `options.into`: map of meter names → pre-allocated arrays for array meters.
  - Returns an object with just the requested meters; for array meters listed in `into`, Seqlok writes into the caller’s buffers instead of allocating.

The controller-side snapshot result is **not ephemeral**: once `snapshot` returns, the data is yours to keep. The
ephemeral-view rules apply to processor-side `within`/`publish`, not to controller-side snapshots.

---

### Meter Invariants

With correct usage:

- Each `snapshot` returns meter values corresponding to a single `SEQ_M`.
- Repeated snapshots see monotonically increasing or equal `SEQ_M`.
- No snapshot sees a half-written array (e.g. half old spectrum, half new).
- Multiple `publish` calls between snapshots are allowed; the Controller just sees the latest committed state at the
  time of `snapshot`.

---

## Quantum Scopes & Nested Calls

A very common pattern (especially in audio) is:

```ts
process(inputs, outputs): boolean {
  this.proc.params.within((params) => {
    // 1. read coherent params
    const result = this.dsp.process(inputs, outputs, params);

    // 2. first meter commit: basic level info
    this.proc.meters.publish((m) => {
      m.peak(result.peak);
      m.rms(result.rms);
    });

    // 3. extra analysis
    const more = this.analyze(result);

    // 4. second meter commit: more detailed info
    this.proc.meters.publish((m) => {
      m.spectralCentroid(more.centroid);
    });
  });

  return true;
}
```

Important points:

- All `publish` calls inside the `within` callback are **logically derived** from the same param snapshot.
- They are **not** grouped into a single param+meter "transaction"; params and meters have independent seqlocks.
- Each `publish` is its own atomic meter commit, seen as such by the Controller.

This is the **“quantum scope”** mental model:

> One `within` defines the param snapshot window.
> Any number of `publish` calls inside that `within` compute and commit meters derived from that snapshot.

Seqlok guarantees:

- Param reads inside that `within` are coherent.
- Each meter commit is coherent.
- The pairing (**this snapshot → these meter commits**) is _causal_ in your code, not enforced as a single hardware
  transaction.

---

## What Seqlok Guarantees (and Does Not)

### Guarantees

Within the documented roles and APIs, Seqlok guarantees:

1. **Per-domain coherence via seqlock**

- Param snapshots from `within` are internally consistent.
- Meter snapshots from `snapshot` are internally consistent.

2. **SWMR discipline per domain**

- Exactly one writer for params, one writer for meters (from Seqlok's perspective).

3. **Monotonic versions**

- Param `SEQ_P` and meter `SEQ_M` are monotonically increasing.
- Readers never see a snapshot from "before" the last one they obtained (assuming calls are ordered).

4. **Atomic meter commits**

- All meter changes within one `publish` are committed as a unit.
- Controllers never see half-updated meters from a single `publish`.

5. **No allocations on hot read paths inside the kernel**

- `within` / `publish` do not allocate user-visible objects in the hot path.
- `snapshot` can be allocation-free when used with `into` buffers.

### Non-Guarantees

Seqlok does **not** guarantee:

1. **Fairness between readers and writers**

- In pathological cases where the writer saturates the seqlock, readers may spin more.
- Design intent is that writes are relatively infrequent compared to reads.

2. **Cross-domain transactions**

- There is no atomic "params + meters move together" transaction across domains.
- Params and meters are separate; your code establishes the causal relationships.

3. **Async safety inside callbacks**

- If you `await` inside `within` or `publish`, you violate the design; behavior is undefined and can break invariants.

4. **Protection against misuse of views**

- JS cannot prevent you from storing a reference to an internal view and using it later.
- The **contract** is that you won't; library behavior assumes usage follows the scope rules.

---

## Execution Example: AudioWorklet Pattern

Golden-flow wiring for a typical browser + AudioWorklet setup.

**Controller (main thread):**

```ts
import {
  defineSpec,
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
} from '@seqlok/core';

const spec = defineSpec(/* ... */);
const plan = planLayout(spec);
const backing = allocateShared(plan);

const controller = bindController(spec, backing);
const handoff = buildHandoff(plan, backing);

audioContext.audioWorklet.addModule('processor.js').then(() => {
  const node = new AudioWorkletNode(audioContext, 'my-processor', {
    processorOptions: { seqlok: handoff },
  });

  // UI → params
  slider.oninput = (e) => {
    controller.params.set('gain', e.valueAsNumber);
  };

  // meters → UI
  function updateMeters() {
    const { peak, rms } = controller.meters.snapshot(['peak', 'rms']);
    ui.setPeak(peak);
    ui.setRms(rms);
    requestAnimationFrame(updateMeters);
  }

  updateMeters();
});
```

**Processor (AudioWorkletGlobalScope / worker):**

```ts
import { receiveHandoff, bindProcessor, type ProcessorBinding } from '@seqlok/core';
import type { DemoSpec } from './spec';

class MyProcessor extends AudioWorkletProcessor {
  private readonly binding: ProcessorBinding<DemoSpec>;

  constructor(opts: any) {
    super();

    const received = receiveHandoff<DemoSpec>(opts.processorOptions.seqlok);
    this.binding = bindProcessor(received);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.binding.params.within((params) => {
      const out = this.dsp.process(inputs[0][0], outputs[0][0], params.gain);

      this.binding.meters.publish((m) => {
        m.peak(out.peak);
        m.rms(out.rms);
      });
    });

    return true;
  }
}

registerProcessor('my-processor', MyProcessor);
```

This is the canonical "Controller ↔ Processor" Seqlok pipeline:

- Main side: `defineSpec → planLayout → allocateShared → buildHandoff → bindController`
- Worklet side: `receiveHandoff → bindProcessor`

---

## Design Invariants (for Contributors)

Internally, the concurrency model relies on several invariants that **must not be broken**:

1. **All shared-state reads/writes go through bindings**

- No module should directly poke `Atomics` on data planes except the lowest-level primitives.

2. **Roles are enforced at the API level**

- `bindController` must not expose meter write capabilities.
- `bindProcessor` must not expose param write capabilities.

3. **Callbacks are synchronous**

- `within`, `publish` must not be `async` (no promises returned, no `await` intended inside).

4. **Seqlock state is always in a single control plane per domain**

- No per-field seqlocks.
- One param seqlock, one meter seqlock per backing.

5. **Specs are structural, not behavioral**

- No "behavior flags" that change concurrency semantics per field.
- Concurrency semantics are always the same: snapshot for params, commit for meters.

If you extend Seqlok's capabilities, check any new feature against these invariants first.

---

## Summary

The concurrency model of Seqlok can be summarized in one line:

> **One writer per domain, shared memory guarded by seqlocks, exposed through scoped
> callbacks (`within` / `publish`) and seqlock-guarded snapshots on the Controller side, so coherent use is the default.**

Everything else — planes, specs, plan, backing, handoff, bindings — exists to make that model:

- **Fast enough** for real-time code
- **Safe enough** for shared memory
- **Clear enough** that you can reason about it at 2AM without hating future-you
