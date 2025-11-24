import { describe, expect, it } from "vitest";

import {
  isSharedBacking,
  isSharedPartitionedBacking,
  isWasmSharedBacking,
  type Backing,
  type SharedBacking,
  type SharedPartitionedBacking,
  type WasmSharedBacking,
} from "../../src/backing/types";

/**
 * Helper to allocate a SharedArrayBuffer of a specific size.
 * Used to populate mock backing structures.
 */
const allocSab = (bytes: number) => new SharedArrayBuffer(bytes);

describe("Backing Type Guards: Runtime Identification", () => {
  it("correctly identifies and narrows a standard contiguous SharedBacking", () => {
    const b: Backing = { kind: "shared", sab: allocSab(16) };

    expect(isSharedBacking(b)).toBe(true);

    // Verify structural access after narrowing
    expect((b satisfies SharedBacking).sab.byteLength).toBe(16);
  });

  it("correctly identifies and narrows a partitioned backing layout", () => {
    const b: Backing = {
      kind: "shared-partitioned",
      planes: {
        PF32: allocSab(4),
        PI32: allocSab(4),
        PB: allocSab(1),
        PU: allocSab(8),
        MF32: allocSab(4),
        MF64: allocSab(8),
        MU32: allocSab(4),
        MU: allocSab(8),
      },
    };

    expect(isSharedPartitionedBacking(b)).toBe(true);
    expect((b satisfies SharedPartitionedBacking).planes.PB.byteLength).toBe(1);
  });

  it("correctly identifies and narrows a WebAssembly shared memory backing", () => {
    const mem = new WebAssembly.Memory({
      initial: 1,
      maximum: 1,
      shared: true,
    });
    const b: Backing = { kind: "wasm-shared", memory: mem };

    expect(isWasmSharedBacking(b)).toBe(true);
    expect(
      (b satisfies WasmSharedBacking).memory.buffer instanceof
        SharedArrayBuffer,
    ).toBe(true);
  });
});
