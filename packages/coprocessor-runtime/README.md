# @seqlok/coprocessor-runtime

AudioWorklet-focused WASM bootstrap primitive, promoted to a first-class Seqlok citizen.

This package is intentionally split into **public entrypoints** (via `exports`)
and **internal implementation folders**. Treat non-exported paths as private.

## Public entrypoints

- `@seqlok/coprocessor-runtime`
  - Errors + host-side helpers + shared protocol types
- `@seqlok/coprocessor-runtime/protocol`
  - Message types, guards, and `wasmBytes` helpers
- `@seqlok/coprocessor-runtime/mount`
  - Main-thread helpers to mount a coprocessor via a `MessagePort`
    (i.e. `AudioWorkletNode.port`)
- `@seqlok/coprocessor-runtime/kernel`
  - AudioWorklet-scope implementation:
    - processor base class
    - environment-agnostic core for tests
    - dynamic backend helper (legacy / dev)

## Source layout

Entry points are folders with an `index.ts`:

- `src/protocol/index.ts`
- `src/mount/index.ts`
- `src/kernel/index.ts`

Root `src/index.ts` is the front door barrel.

## Backends

The kernel supports two instantiation backends behind one protocol:

- **Bundled (CSP-safe):** omit `wrapperJs`, resolve factory via registry by `key`.
  - Supports modern Emscripten ES module wrappers (`EXPORT_ES6=1`) via static import.
- **Dynamic (dev/compat):** include `wrapperJs`, instantiate via `new Function()` and
  export-detection shim.
  - Requires CSP allowing runtime code generation (`unsafe-eval`).

## Protocol

Message types are `cp:*`:

- `cp:mount` (host -> worklet)
- `cp:ready`, `cp:error`, `cp:log` (worklet -> host)

`wasmBytes` accepts `ArrayBuffer | SharedArrayBuffer | ArrayBufferView` (e.g. `Uint8Array`).

## Notes

- `@seqlok/coprocessor-runtime/kernel` is a worklet-side API surface.
  Keep it isolated from host-only dependencies.
- Non-exported paths may change without notice.
