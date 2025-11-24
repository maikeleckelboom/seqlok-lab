import { describe, expect, it } from "vitest";

import { backingByteLength } from "../../src/backing/allocate-shared";

describe("Backing Byte Length: Buffer Size Resolution", () => {
  it("returns the exact byte length for a standard contiguous SharedArrayBuffer backing", () => {
    const size = 256;
    const sab = new SharedArrayBuffer(size);

    const len = backingByteLength({ kind: "shared", sab } as const);

    expect(len).toBe(size);
  });

  it("returns the exact byte length for a WebAssembly shared memory backing", () => {
    // Allocate 1 page (64KB) of shared Wasm memory
    const memory = new WebAssembly.Memory({
      shared: true,
      initial: 1,
      maximum: 1,
    });

    const len = backingByteLength({ kind: "wasm-shared", memory } as const);

    // Expect exact match with the underlying buffer
    expect(len).toBe(memory.buffer.byteLength);
  });
});
