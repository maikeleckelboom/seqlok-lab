# @seqlok/core

**Seqlok**

A typed shared-memory wire for timing-sensitive systems on the web and beyond.

Seqlok is for the uncomfortable boundary where one side of your program is soft and ergonomic, and the other side has a
real time budget.

Typical shape:

- a **controller** side that writes params and reads meters
- a **processor** side that reads params and writes meters
- one or more **observer** sides that read both without ever becoming writers

All of them share one planned substrate.
Readers get coherent snapshots.
Writers commit explicit updates.
The hot path stays narrow.

---

## What Seqlok is for

Seqlok is not for ordinary worker messaging or general app state.

It is for the narrower case where:

- one side of the boundary has genuine timing pressure
- readers cannot tolerate half-written state
- the hot path should stay bounded and allocation-free
- you want a real memory contract instead of ad hoc byte-offset folklore

Audio is the clearest example, but the shape is broader than audio.
The same discipline applies anywhere a high-frequency lane must cross a runtime boundary cleanly.

---

## The real model

Seqlok does not begin with a runtime-only builder object.

It begins with an authored contract.

That contract has a canonical form: a serializable authored spec AST.
The TypeScript builder DSL is the premium authoring surface over that AST, not the canonical format itself.

Today, the public entrypoint is still `defineSpec(...)`.
That function accepts either:

- a builder callback
- or a plain authored AST object

and currently performs the authored-contract boundary that turns authored input into the validated runtime contract
consumed by planning.

Conceptually, the stack is:

```text
Builder DSL ───────┐
                   ▼
Authored AST
  → semantic compilation
    → runtime contract
      → deterministic plan
        → shared backing
          → explicit handoff
            → received handoff
              → role-specific bindings
```

Core does **not** yet expose semantic compilation as a separate public function.
Today, that boundary is performed inside `defineSpec(...)`.

That is why the public flow still looks like:

```ts
const spec = defineSpec(/* builder callback or plain AST */);
const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, plan, backing);
const handoff = buildHandoff(plan, backing);
```

The important point is conceptual:

- the builder is not the canonical contract
- the authored AST is the canonical contract
- planning starts after authored input has already crossed the validation boundary

---

## Status

Current core center:

- single-writer, multi-reader seqlock substrate
- controller / processor / observer role model
- deterministic layout planning
- explicit handoff model
- contiguous and partitioned shared backings
- typed planes over shared memory
- no ambient registry
- no reactive-store ambitions hidden inside the wire

This package is intentionally narrow.
It solves one class of crossing well.

---

## Install

```bash
pnpm add @seqlok/core
```

---

## Runtime requirements

- ESM-capable runtime
- `SharedArrayBuffer` must be available
- browser environments need the correct cross-origin isolation setup for SAB
- worker / worklet arrangements must be hosted in an environment where SAB is actually enabled

---

## Canonical public flow

There is one main public flow:

1. author a contract with `defineSpec(...)`
2. derive a deterministic layout with `planLayout(...)`
3. allocate shared backing with `allocateShared(...)` or `allocateSharedPartitioned(...)`
4. bind the controller on the owner side
5. build a handoff
6. receive the handoff on the consumer side
7. bind a processor and optionally one or more observers

   ```ts
   const spec = defineSpec(/* params + meters schema */);
   ```

2. **Plan** – how it is laid out in memory

   ```ts
   const plan = planLayout(spec);
   ```

3. **Backing** – where it lives (actual shared memory)

   ```ts
   const backing = allocateShared(plan);
   ```

4. **Handoff** – how layout + backing cross a trust boundary

   ```ts
   const handoff = buildHandoff(plan, backing);
   ```

5. **AcceptedHandoff + bindings** – how the other side sees it

   ```ts
   const accepted = acceptHandoff(handoff);
   const controller = bindController(spec, plan, backing);
   const processor = bindProcessor(accepted);
   ```

The important rule:

> `planLayout` is called exactly once at the **Spec → Plan** boundary.
> Backing and binding **consume** `Plan` — they never recompute it.

There is **no** `bindController(spec, backing)` sugar in core.
If you want shortcuts, you build them _on top_ of this flow.

---

## Quick start

### 1. Author a contract

Builder form:

```ts
import {defineSpec} from "@seqlok/core";

export const laneSpec = defineSpec(({param, meter}) => ({
  id: "lane",
  params: {
    timeRatio: param.f32({min: 0.25, max: 4}),
    eqBands: param.f32.array({length: 8}),
    mode: param.enum(["normal", "granular"]),
  },
  meters: {
    rms: meter.f32(),
    peak: meter.f32(),
    framesProcessed: meter.u32(),
  },
}));

export type LaneSpec = typeof laneSpec;
```

Plain object form:

```ts
import {defineSpec} from "@seqlok/core";

export const laneSpec = defineSpec({
  id: "lane",
  params: {
    timeRatio: {kind: "f32", min: 0.25, max: 4},
    eqBands: {kind: "f32.array", length: 8},
    mode: {kind: "enum", values: ["normal", "granular"]},
  },
  meters: {
    rms: {kind: "f32"},
    peak: {kind: "f32"},
    framesProcessed: {kind: "u32"},
  },
});
```

Both routes feed the same authored-contract model.

### 2. Owner side: plan, allocate, bind controller, build handoff

```ts
import {
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
  type Handoff,
} from "@seqlok/core";
import {laneSpec, type LaneSpec} from "./spec";

const plan = planLayout(laneSpec);
const backing = allocateShared(plan);

const controller = bindController(laneSpec, plan, backing);
const handoff: Handoff<LaneSpec> = buildHandoff(plan, backing);

worker.postMessage({type: "handoff", handoff});

// scalar write
controller.params.set("timeRatio", 1.5);

// atomic multi-scalar patch
controller.params.update({mode: "granular"});

// array write with one commit
controller.params.stage("eqBands", (view) => {
  for (let i = 0; i < view.length; i += 1) {
    view[i] = i < 4 ? -3 : 3;
  }
});
```

### 3. Worker / processor side: accept handoff → bind processor

```ts
import {
  acceptHandoff,
  bindProcessor,
  type Handoff,
  type ProcessorBinding,
} from "@seqlok/core";
import type {LaneSpec} from "./spec";

type InitMessage = {
  type: "handoff";
  handoff: Handoff<LaneSpec>;
};

let processor: ProcessorBinding<LaneSpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== "handoff") return;

  const accepted = acceptHandoff(ev.data.handoff);
  processor = bindProcessor(accepted);
};

function processBlock(): void {
  if (!processor) return;

  processor.params.within((params) => {
    const framesForBlock = Math.floor(128 * params.timeRatio);

    processor.meters.publish((writer) => {
      writer.rms(0.5);
      writer.peak(0.9);
      writer.framesProcessed(framesForBlock);
    });
  });
}
```

That is the canonical lane.

---

## Observer

Observer is a real first-class role, not conceptual garnish.

An observer:

- never writes params
- never writes meters
- reads the same planned substrate coherently
- exists for HUDs, visualizers, inspectors, telemetry workers, and similar passive consumers

// Directly from spec + plan + backing
const plan = planLayout(laneSpec);
const backing = allocateShared(plan);

const observer: ObserverBinding<LaneSpec> = bindObserver(
  laneSpec,
  plan,
  backing,
);
```

Or, if you built a shared context (see next section), you can bind from that.

### Worker-side: bind from an accepted handoff

```ts
import {
  acceptHandoff,
  bindObserver,
  type Handoff,
  type AcceptedHandoff,
} from "@seqlok/core";
import type {LaneSpec} from "./spec";

let observer: ObserverBinding<LaneSpec> | undefined;

self.onmessage = (
  ev: MessageEvent<{ type: "handoff"; handoff: Handoff<LaneSpec> }>
) => {
  if (ev.data.type !== "handoff") return;

  const accepted: AcceptedHandoff<LaneSpec> = acceptHandoff(ev.data.handoff);
  observer = bindObserver(accepted);
};

function sampleTelemetry(): void {
  if (!observer) return;

  const meters = observer.meters.snapshot(["rms", "peak"]);
  const params = observer.params.snapshot(["timeRatio", "mode"]);

  console.log({params, meters});
}
```

### Bind locally from owner-side materials

```ts
import {
  planLayout,
  allocateShared,
  bindController,
  bindObserver,
} from "@seqlok/core";
import {laneSpec} from "./spec";

const plan = planLayout(laneSpec);
const backing = allocateShared(plan);

const controller = bindController(laneSpec, plan, backing);
const observer = bindObserver(laneSpec, plan, backing);

controller.params.update({mode: "granular"});

const params = observer.params.snapshot(["timeRatio", "mode"]);
console.log(params);
```

That is important because it proves observer is a legal read surface, not merely “the far-side role”.

---

## Shared context helper

For host-side code that wants to reuse the same `{ spec, plan, backing }` triple, core exposes a small convenience
helper:

```ts
import {
  createSharedContext,
  bindController,
  bindObserver,
  buildHandoff,
} from "@seqlok/core";
import {laneSpec} from "./spec";

const ctx = createSharedContext(laneSpec);

const controller = bindController(ctx);
const observer = bindObserver(ctx);
const handoff = buildHandoff(ctx);
```

This does **not** change the underlying model.
It is host-side convenience over the same canonical flow.

---

## Backing strategies

The same plan can be realized with different backing strategies.

Golden path:

```ts
const backing = allocateShared(plan);
```

Partitioned per-plane backing:

```ts
const backing = allocateSharedPartitioned(plan);
```

The point is that the contract and the plan stay the same.
Only the backing strategy changes.

That keeps the memory story explicit instead of magical.

---

## Why there is no `subscribe` or public transaction API

Seqlok is a wire, not a reactive store.

That is why core does **not** own:

- subscriptions
- framework-specific reactivity semantics
- rich transactional state models
- convenience abstractions that hide commit boundaries

  - `defineSpec`
  - `planLayout`
  - `allocateShared`
  - `buildHandoff`
  - `acceptHandoff`
  - `bindController` (spec + plan + backing)
  - `bindProcessor`
  - `bindObserver`

---

## License

See the repository license for current licensing terms.
