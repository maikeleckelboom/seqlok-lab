# How Enum Arrays Work: Schema vs Runtime Data

When you define an enum array like this:

```ts
enumArray: param.enum.array({ values: ['a', 'b', 'c'], length: 10 });
```

this **does not** allocate an array of repeated strings.

It defines:

- A fixed-length array with 10 slots
- Each slot can hold one of `'a' | 'b' | 'c'`
- Backed by **integer indices** in shared memory (`PI32` plane)

Enum arrays are **schema-first**: a small palette of labels + a length, mapped to a tight numeric representation.

---

## 1. The Schema Object (Metadata)

`defineSpec` creates a **schema descriptor** for the field:

```ts
const schema = {
  kind: 'enum.array',
  values: ['a', 'b', 'c'], // ← the "vocabulary" or palette
  length: 10, // ← number of elements
};
```

This is pure metadata:

- `values` – allowed labels (the palette)
- `length` – fixed number of slots (the shape)

The schema:

- Is created once at spec definition time
- Is used by both controller and processor bindings
- Never changes at runtime

It's part of the **Spec → Plan → Backing → Bindings** pipeline:

```text
Spec (enum.array) → Plan (PI32 slice) → Backing (Int32Array) → Bindings (labels or indices)
```

---

## 2. Runtime Data: Indices in `PI32`

At runtime, the planner allocates a slice of the **PI32** plane for the enum array:

```ts
// Backing for one enum array field:
const backing = new Int32Array(10);
// SAB is zero-initialized → backing = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
```

Each element stores an **index into `values`**:

- `0` → `'a'`
- `1` → `'b'`
- `2` → `'c'`

Because `SharedArrayBuffer` is zero-initialized:

- All entries start as `0`
- So the default logical state is "all slots are `values[0]`” (`'a'` in this example)

### Why store indices?

Storing indices instead of strings is:

1. **Memory-efficient** – fixed 4 bytes per slot
2. **Fast** – numeric loads/stores, no string comparisons
3. **Cache-friendly** – tightly packed, predictable layout
4. **Interop-friendly** – trivial to feed into DSP, MIDI, WebGPU, Wasm, etc.

---

## 3. How the Mapping Works

Bindings translate between **user-facing labels** and **internal indices**.

### Example runtime state

```ts
const values = ['a', 'b', 'c']; // from the schema

// backing in PI32:
const backing = Int32Array.of(0, 2, 1, 0, 1, 2, 0, 1, 2, 1);
//                       ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓
// logical view:        'a','c','b','a','b','c','a','b','c','b'
```

### Reading (conceptual)

```ts
// controller side: labels
const value = enumArray[3]; // 'a'

// internal:
const index = backing[3]; // 0
const value2 = values[index]; // 'a'
```

### Writing (conceptual)

```ts
// controller side: labels
enumArray[5] = 'b';

// internal:
const index = values.indexOf('b'); // 1
backing[5] = index;
```

So:

- **Schema** (`values`) is the lookup table.
- **Backing** (`Int32Array`) stores indices.
- **Bindings** handle conversion at the API boundary.

---

## 4. Controller vs Processor Views

Enum arrays look different on each side because they serve different purposes.

### 4.1 Controller – label world

On the controller (UI / host), the API is ergonomic and type-safe:

- You work in terms of **labels** (`'a' | 'b' | 'c'`).
- `params.update` accepts arrays of labels for enum arrays.
- TypeScript encodes the label union from the spec.

Conceptual controller-side type:

```ts
type EnumLabel = 'a' | 'b' | 'c';
type EnumArrayLabels = readonly EnumLabel[]; // length fixed by spec

ctl.params.update({
  enumArray: ['a', 'c', 'b', 'b', 'a', 'a', 'c', 'c', 'b', 'a'],
});
```

Under the hood, the controller binding:

1. Validates that each element is one of the declared labels.
2. Maps each label to an index in `values`.
3. Writes those indices into the shared `Int32Array` slice.

### 4.2 Processor – index world

On the processor (worker / AudioWorklet / Wasm), the API is hot-path-oriented:

- You get a **typed view** over the backing (usually `Int32Array`).
- You deal purely in **indices** (`0`, `1`, `2`, …).
- If you need labels at all, you can map via `values[index]` in your own code (rare in DSP loops).

Conceptually, inside `params.within`:

```ts
proc.params.within((p) => {
  const indices = p.enumArray; // Int32Array alias into PI32
  const firstIndex = indices[0]; // 0 | 1 | 2, etc.

  // numeric hot path:
  if (firstIndex === 0) {
    // treat as 'a'
  } else if (firstIndex === 1) {
    // treat as 'b'
  } else {
    // 'c'
  }
});
```

The aliasing view:

- Is created at bind time.
- Points directly into the backing.
- Is reused on every `within` call (no allocations).

---

## 5. Invariants & Validation

Enum arrays come with a few important invariants.

### 5.1 Index range

If `values.length === N`:

- Every element of the backing is in `[0, N - 1]` in the valid state.
- Controller writes enforce this by validating labels.

### 5.2 Default contents

`SharedArrayBuffer` is zero-initialized:

- All entries start at `0`.
- The logical default is "all slots equal `values[0]`”.

If you want a different initial state:

- Either update from the controller after bind.
- Or apply your own initialization in the processor (e.g. special-case `0`).

### 5.3 Fixed shape and vocabulary

Both shape and vocabulary are **frozen by the spec**:

- `length` is fixed — the array never grows or shrinks.
- `values` is fixed — you do not add/remove labels at runtime.

Changing `length` or `values` produces a **different spec** and therefore a different plan/hash.

### 5.4 Validation and trust boundary

- **Controller:** validates labels against the vocabulary and shape at write time.
- **Processor:** trusts indices (no bounds checks in the hot path).

If something corrupts the backing (e.g. rogue writes) and injects an out-of-range index, behaviour is undefined. The assumption is **only bindings write into `PI32`** for spec-defined fields.

---

## 6. Visual Comparison

### ❌ What it’s _not_

```ts
// There is no array of strings in shared memory:
['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c', 'a'];
```

### ✅ What it actually is

```ts
// Schema (metadata)
const schema = {
  kind: 'enum.array',
  values: ['a', 'b', 'c'],
  length: 10,
};

// Data (backing)
Int32Array(10)[(0, 1, 2, 0, 1, 2, 0, 1, 2, 0)];
//                     ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓  ↓
//                 maps through schema.values[index]
```

---

## 7. Example: MIDI Pad LED Bank

A natural enum-array use case is a **MIDI pad LED bank** (e.g. an 8×8 grid controller).

Each pad can be in one of three states:

- `'off'` – LED off
- `'dim'` – low-intensity (preview/inactive)
- `'full'` – full-intensity (active/armed)

Model that as a single enum-array param:

```ts
// spec.ts
export const spec = defineSpec(({ param, meter }) => ({
  id: 'midi-led-bank',
  params: {
    padStates: param.enum.array({
      values: ['off', 'dim', 'full'],
      length: 64, // 8x8 grid
    }),
  },
  meters: {
    // ... any meters you want
  },
}));
```

### 7.1 Controller: updating pad states from UI

On the controller, you work in labels:

```ts
// controller.ts
const padCount = 64;

// local copy used for UI logic / diffs
let currentStates: ('off' | 'dim' | 'full')[] = Array.from(
  { length: padCount },
  () => 'off',
);

function setPadState(index: number, next: 'off' | 'dim' | 'full') {
  currentStates[index] = next;

  ctl.params.update({
    padStates: currentStates,
  });
}

// simple toggle: 'off' ↔ 'full'
function togglePad(index: number) {
  const prev = currentStates[index];
  const next = prev === 'off' ? 'full' : 'off';
  setPadState(index, next);
}
```

Notes:

- You never manipulate indices yourself.
- TypeScript knows `padStates` is an array of `'off' | 'dim' | 'full'`.
- The binding converts labels → indices and writes into `PI32`.

### 7.2 Processor: driving MIDI LEDs from indices

On the processor, you get the `Int32Array` view:

```ts
// processor.ts
proc.params.within((v) => {
  const states = v.padStates; // Int32Array, length 64

  for (let i = 0; i < states.length; i++) {
    const index = states[i]; // 0 = 'off', 1 = 'dim', 2 = 'full'

    const velocity =
      index === 0
        ? 0 // 'off'
        : index === 1
          ? 40 // 'dim'
          : 127; // 'full'

    const note = padNoteForIndex(i); // your mapping (0..63) → MIDI note
    sendMidiNoteOn(note, velocity);
  }
});
```

This plays nicely with Seqlok's design:

- The **controller** is ergonomic and expressive (labels).
- The **processor** is tight and numeric (indices).
- All shared state is a simple `Int32Array` slice in the `PI32` plane.

You can later add meters (e.g. activity meters per pad) using the usual numeric meter families; enum-array meters are a potential future extension, but params already cover the most common LED-bank control flows.

---

## 8. Key Takeaways

1. `values` is the **palette**, not the data; the data is indices into `values`.
2. `length` defines the number of **slots**, not how many times to repeat the palette.
3. Runtime storage is an `Int32Array` slice in the `PI32` plane.
4. Controllers see **label arrays**; processors see **index arrays**.
5. Validation happens on the controller; the processor runs with trusted indices.
6. This pattern is perfect for dense, discrete-state grids (LED banks, step sequencers, pattern memories) where you want **ergonomic labels on the host** and **lean numeric state in shared memory**.
