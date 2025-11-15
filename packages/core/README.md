# @seqlok/core

**Zero-copy, lock-free state synchronization for real-time systems.**

A typed shared-memory layer between a **Controller** (main/UI thread) and a **Processor** (Worker / AudioWorklet).
The Controller writes **params**, the Processor writes **meters**—both with atomic, coherent reads via a seqlock
protocol.

## Why Seqlok?

- **Zero allocations** – direct typed-array access over `SharedArrayBuffer`
- **Type-safe** – full TypeScript inference from spec through plan, backing, and bindings
- **Coherent reads** – readers never observe torn/partial state
- **Predictable** – deterministic memory layout, no hidden orchestration

```ts
// Define once, use everywhere
import { defineSpec } from '@seqlok/core';

export const spec = defineSpec(({ param, meter }) => ({
  id: 'synth',
  params: {
    cutoff: param.f32({ min: 20, max: 20_000 }),
  },
  meters: {
    level: meter.f32(),
  },
}));
```

---

## Install

```bash
pnpm add @seqlok/core
```

**Requirements:** ESM-only (Browser ≈2022+ / Node 20+), with `SharedArrayBuffer` enabled
(e.g. COOP/COEP headers in the browser, or a compatible runtime embedding).

---

## Quick Start

### Step 1: Define your spec — `src/spec.ts`

```ts
import { defineSpec } from '@seqlok/core';

export const spec = defineSpec(({ param, meter }) => ({
  id: 'demo',
  params: {
    timeRatio: param.f32({ min: 0.25, max: 4 }),
    coeffs: param.f32.array({ length: 8 }),
    mode: param.enum({ values: ['normal', 'granular'] }),
  },
  meters: {
    rms: meter.f32(),
    peak: meter.f32(),
    spectrum: meter.f32.array({ length: 1024 }),
    frames: meter.u32(),
  },
}));

export type DemoSpec = typeof spec;
```

### Step 2: Bind the controller — `src/main.ts`

```ts
import {
  planLayout,
  allocateShared,
  buildHandoff,
  bindController,
  type Handoff,
} from '@seqlok/core';
import { spec, type DemoSpec } from './spec';

const plan = planLayout(spec);
const backing = allocateShared(plan);
const controller = bindController(spec, backing);

const handoff: Handoff<DemoSpec> = buildHandoff(plan, backing);

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ type: 'handoff', handoff });

controller.params.update({
  timeRatio: 1.5,
});

controller.params.stage('coeffs', (view) => {
  for (let i = 0; i < view.length; i++) {
    view[i] = Math.random();
  }
});

let lastVersion = 0;

function pollMeters() {
  const v = controller.meters.version();
  if (v !== lastVersion) {
    const { rms, spectrum } = controller.meters.snapshot('rms', 'spectrum');
    // use rms + spectrum...
    lastVersion = v;
  }
  requestAnimationFrame(pollMeters);
}

pollMeters();
```

### Step 3: Bind the processor — `src/worker.ts`

```ts
import {
  receiveHandoff,
  bindProcessor,
  type Handoff,
  type ProcessorBinding,
} from '@seqlok/core';
import type { DemoSpec } from './spec';

type InitMessage = {
  type: 'handoff';
  handoff: Handoff<DemoSpec>;
};

let processor: ProcessorBinding<DemoSpec> | undefined;

self.onmessage = (ev: MessageEvent<InitMessage>) => {
  if (ev.data.type !== 'handoff') return;

  const received = receiveHandoff(ev.data.handoff);
  processor = bindProcessor(received);
};

function processBlock() {
  if (!processor) return;

  processor.params.within((params) => {
    const { timeRatio, coeffs, mode } = params;

    processor.meters.publish((writer) => {
      writer.rms(0.42);
      writer.peak(0.71);

      writer.stage('spectrum', (buf) => {
        for (let i = 0; i < buf.length; i++) {
          buf[i] = i & 1 ? 0 : 1;
        }
      });

      writer.frames(123_456);
    });
  });
}
```

---

## Memory Layout

Seqlok organizes memory into **planes** by type. Each plane is a typed view over a shared backing.

### Param planes

| Plane  | Types                                             | Usage                                        |
| :----- | :------------------------------------------------ | :------------------------------------------- |
| `PF32` | `param.f32`, `param.f32.array({ length })`        | Float32 params                               |
| `PI32` | `param.i32`, `param.i32.array({ length })`, enums | Int32 params + enum indices                  |
| `PB`   | `param.bool`, `param.bool.array({ length })`      | Boolean params as `0/1` bytes (`Uint8Array`) |
| `PU`   | —                                                 | Param seqlock control `[LOCK, SEQ]`          |

### Meter planes

| Plane  | Types                                      | Usage                                       |
| :----- | :----------------------------------------- | :------------------------------------------ |
| `MF32` | `meter.f32`, `meter.f32.array({ length })` | Float32 meters                              |
| `MF64` | `meter.f64`, `meter.f64.array({ length })` | Float64 meters                              |
| `MU32` | `meter.u32`, `meter.bool`                  | Uint32 meters, bool meters as `0/1` numbers |
| `MU`   | —                                          | Meter seqlock control `[LOCK, SEQ]`         |

Bindings precompute indices from byte offsets; normal user code never touches raw offsets.

---

## Documentation

Seqlok's design is documented in depth. This is the recommended reading order.

### Core concepts (start here)

- [E2E Flow – Visual Guide](./docs/architecture/06-seqlok-e2e-flow-visual-guide.md)
  High-level mental model of the `spec → plan → backing → handoff → bindings` pipeline.
- [Concurrency Model & Roles](./docs/architecture/03-seqlok-concurrency-model-and-roles.md)
  Controller vs Processor, params vs meters, and coherence guarantees.
- [DSL Overview & Rationale](./docs/architecture/04-seqlok-dsl-overview-and-rationale.md)
  How to define state with `defineSpec`.
- [API Reference](./docs/architecture/09-seqlok-api-reference.md)
  Canonical reference for all public functions and types.

### Architectural rationale (the "why")

- [Origin & Design History](./docs/architecture/00-seqlok-origin-and-design-history.md)
- [Goals & Non-Goals](./docs/architecture/01-seqlok-goals-and-non-goals.md)
- [Intellectual Heritage](./docs/architecture/02-seqlok-intellectual-heritage.md)
- [Object Model Rationale](./docs/architecture/06-object-model-rationale.md)
- [API Shape Rationale](./docs/architecture/07-seqlok-api-shape-rationale.md)
- [API & Naming Rationale](./docs/architecture/08-seqlok-api-and-naming-rationale.md.md)

### Coherence & memory model

- [Primitives & Seqlock](./docs/architecture/10-seqlok-primitives-and-seqlock.md)
- [Backing & Plane Layout](./docs/architecture/11-seqlok-backing-and-plane-layout.md)
- [Coherent Reads & Planes](./docs/architecture/12-coherent-reads-and-planes.md)
- [Implementation Notes (Kernel)](./docs/architecture/13-implementation-notes-kernel.md)

### Deep dives

- [Enum Arrays – Schema vs Runtime](./docs/architecture/05-enum-arrays-runtime-behavior.md)
- [ABA/Wraparound: Not a Bug](./docs/architecture/14-seqlok-aba-wraparound-not-a-bug.md)
- [Error System & Fail-Fast Philosophy](./docs/architecture/15-seqlok-error-system-and-fail-fast-philosophy.md)

### Reference & ADRs

- [API Reference](./docs/architecture/09-seqlok-api-reference.md)
- [ADR-2025-11-12 — Meter Writes & Snapshot `into`](./docs/adr/ADR-2025-11-12-meter-writes-and-snapshot-into.md)

---

## License

MIT
