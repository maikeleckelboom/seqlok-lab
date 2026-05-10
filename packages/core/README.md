# @seqlok/core

A typed shared-memory contract and binding layer for timing-sensitive systems on the web and beyond.

Seqlok is for the boundary where one side of the system is soft and ergonomic, and the other side has a real time budget.

Typical shape:

- a **controller** writes params and reads meters
- a **processor** reads params and writes meters
- one or more **observers** read both without becoming writers

All roles share one planned substrate.
Readers get coherent snapshots.
Writers commit explicit updates.
The hot path stays narrow.

---

## What core is for

Seqlok is not for general app state or ordinary worker messaging.

It is for the narrower case where:

- one side of the boundary has genuine timing pressure
- readers cannot tolerate half-written state
- the hot path should stay bounded and allocation-free
- you want an explicit memory contract instead of byte-offset folklore

Audio is the clearest example, but the model is broader than audio.

---

## The model

Seqlok begins with an authored contract.

That contract has a canonical form: a serializable authored spec AST.
The TypeScript builder DSL is an authoring surface over that AST, not the canonical format itself.

`defineSpec(...)` accepts either:

- a builder callback
- a plain authored AST object

and performs the semantic-compilation boundary that turns authored input into the validated runtime contract consumed by planning.

Conceptually:

```text
Builder DSL ───────┐
                   ▼
Authored AST
  → semantic compilation
    → runtime contract
      → deterministic plan
        → shared backing
          → explicit handoff
            → accepted handoff
              → role-specific bindings
```

Important points:

- the builder is not the canonical contract
- the authored AST is the canonical contract
- flat dot-path keys remain the runtime identity
- `keysOf(spec)` is optional ergonomic sugar, not a second identity model

---

## Canonical public flow

The main public flow is:

1. author a contract with `defineSpec(...)`
2. optionally derive ergonomic keys with `keysOf(spec)`
3. derive a deterministic layout with `planLayout(...)`
4. allocate shared backing
5. bind the controller on the owner side
6. build a handoff
7. accept the handoff on the consumer side
8. bind a processor and optionally one or more observers

`planLayout` is called exactly once at the **Spec → Plan** boundary. Backing and bindings consume `Plan`. They do not recompute it.

There is no `bindController(spec, backing)` sugar in core.

---

## Quick start

### 1. Author a contract

Builder form:

```ts
import { defineSpec, keysOf } from "@seqlok/core";

export const laneSpec = defineSpec(({ param, meter }) => ({
  id: "lane",
  params: {
    transport: {
      timeRatio: param.f32({ min: 0.25, max: 4 }),
      mode: param.enum(["normal", "granular"]),
    },
    mixer: {
      eqBands: param.f32.array({ length: 8 }),
    },
  },
  meters: {
    output: {
      rms: meter.f32(),
      peak: meter.f32(),
    },
    engine: {
      framesProcessed: meter.u32(),
    },
  },
}));

export const laneKeys = keysOf(laneSpec);
export type LaneSpec = typeof laneSpec;
```

Plain object form:

```ts
import { defineSpec } from "@seqlok/core";

export const laneSpec = defineSpec({
  id: "lane",
  params: {
    transport: {
      timeRatio: { kind: "f32", min: 0.25, max: 4 },
      mode: { kind: "enum", values: ["normal", "granular"] },
    },
    mixer: {
      eqBands: { kind: "f32.array", length: 8 },
    },
  },
  meters: {
    output: {
      rms: { kind: "f32" },
      peak: { kind: "f32" },
    },
    engine: {
      framesProcessed: { kind: "u32" },
    },
  },
});
```

Both routes feed the same authored-contract model.

### 2. Owner side

```ts
import {
  allocateShared,
  bindController,
  buildHandoff,
  planLayout,
  type Handoff,
} from "@seqlok/core";
import { laneKeys, laneSpec, type LaneSpec } from "./spec";

const plan = planLayout(laneSpec);
const backing = allocateShared(plan);

const controller = bindController(laneSpec, plan, backing);
const handoff: Handoff<LaneSpec> = buildHandoff(plan, backing);

controller.params.set(laneKeys.params.transport.timeRatio, 1.5);
controller.params.update({
  [laneKeys.params.transport.mode]: "granular",
});

controller.params.stage(laneKeys.params.mixer.eqBands, (view) => {
  for (let i = 0; i < view.length; i += 1) {
    view[i] = i < 4 ? -3 : 3;
  }
});
```

### 3. Processor side

```ts
import {
  acceptHandoff,
  bindProcessor,
  type Handoff,
  type ProcessorBinding,
} from "@seqlok/core";
import { laneKeys, type LaneSpec } from "./spec";

type InitMessage = {
  type: "handoff";
  handoff: Handoff<LaneSpec>;
};

let processor: ProcessorBinding<LaneSpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== "handoff") return;
  processor = bindProcessor(acceptHandoff(ev.data.handoff));
};

function processBlock(): void {
  if (!processor) return;

  processor.params.within((params) => {
    const timeRatio = params[laneKeys.params.transport.timeRatio];

    processor.meters.publish((writer) => {
      writer.set(laneKeys.meters.output.rms, 0.5);
      writer.set(laneKeys.meters.output.peak, 0.9);
      writer.set(
        laneKeys.meters.engine.framesProcessed,
        Math.floor(128 * timeRatio),
      );
    });
  });
}
```

### 4. Observer side

```ts
import {
  acceptHandoff,
  bindObserver,
  type Handoff,
  type ObserverBinding,
} from "@seqlok/core";
import { laneKeys, type LaneSpec } from "./spec";

let observer: ObserverBinding<LaneSpec> | undefined;

self.onmessage = (
  ev: MessageEvent<{ type: "handoff"; handoff: Handoff<LaneSpec> }>,
) => {
  if (ev.data.type !== "handoff") return;
  observer = bindObserver(acceptHandoff(ev.data.handoff));
};

function sampleTelemetry(): void {
  if (!observer) return;

  const params = observer.params.snapshot(
    laneKeys.params.transport.timeRatio,
    laneKeys.params.transport.mode,
  );

  const meters = observer.meters.snapshot(
    laneKeys.meters.output.rms,
    laneKeys.meters.output.peak,
  );

  console.log({ params, meters });
}
```

---

## Shared context helper

If host-side code wants to reuse the same `{ spec, plan, backing }` triple, core exposes a small convenience helper:

```ts
import {
  bindController,
  bindObserver,
  buildHandoff,
  createSharedContext,
} from "@seqlok/core";
import { laneSpec } from "./spec";

const ctx = createSharedContext(laneSpec);

const controller = bindController(ctx);
const observer = bindObserver(ctx);
const handoff = buildHandoff(ctx);
```

This does not change the underlying model.
It is convenience over the same explicit flow.

---

## Backing strategies

The same plan can be realized with different backing strategies.

```ts
const backing = allocateShared(plan);
```

```ts
const backing = allocateSharedPartitioned(plan);
```

The contract and the plan stay the same.
Only the backing strategy changes.

---

## Why there is no `subscribe`

Seqlok is a wire, not a reactive store.

That is why core does not own:

- subscriptions
- framework-specific reactivity semantics
- rich transactional state models
- convenience abstractions that hide commit boundaries

The core surface stays centered on:

- `defineSpec`
- `keysOf`
- `planLayout`
- `allocateShared`
- `buildHandoff`
- `acceptHandoff`
- `bindController`
- `bindProcessor`
- `bindObserver`

---

## License

See the repository license for current licensing terms.
