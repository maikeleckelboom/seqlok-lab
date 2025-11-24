import { afterEach, describe, expect, it, vi } from "vitest";

import { allocateWasmShared } from "../../src/backing/allocate-wasm-shared";
import { isSeqlokError } from "../../src/errors/error";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Allocate Wasm Shared: Shared Memory Validation", () => {
  it("throws backing.wasmMemoryNotShared when the allocated WebAssembly memory buffer is not shared", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "wasm-shared-check",
      params: { p: param.f32({ min: 0, max: 1 }) },
      meters: { m: meter.f32() },
    }));
    const plan = planLayout(spec);

    // Mock: Simulate an environment where WebAssembly.Memory returns a standard ArrayBuffer.
    // This happens in browsers if COOP/COEP headers are missing, even if Wasm is supported.
    class NonSharedMemory {
      private readonly _buf = new ArrayBuffer(1024);
      get buffer(): ArrayBuffer {
        return this._buf;
      }
    }

    vi.stubGlobal("WebAssembly", {
      Memory: NonSharedMemory as unknown as typeof WebAssembly.Memory,
    } as unknown as typeof WebAssembly);

    let thrown: unknown;

    try {
      allocateWasmShared(plan);
    } catch (e) {
      thrown = e;
    }

    // Verify the error is strictly typed and contains the expected diagnostic details
    if (!isSeqlokError(thrown)) {
      throw new Error("Expected allocateWasmShared to throw a SeqlokError");
    }

    expect(thrown.code).toBe("backing.wasmMemoryNotShared");
    expect(thrown.details.where).toBe("allocateWasmShared");

    if ("shared" in thrown.details) {
      expect(thrown.details.shared).toBe(false);
    }
  });
});
