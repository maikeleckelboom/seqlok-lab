import { afterEach, describe, expect, it, vi } from "vitest";

import { allocateWasmShared } from "../../src/backing/allocate-wasm-shared";
import { isSeqlokError } from "../../src/errors/error";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Allocate Wasm Shared: Constructor Failure Handling", () => {
  it("wraps synchronous WebAssembly.Memory constructor errors into a typed SeqlokError", () => {
    // Define a minimal spec to generate a valid layout plan
    const spec = defineSpec(({ param, meter }) => ({
      id: "wasm-failure-test",
      params: { p: param.f32({ min: 0, max: 1 }) },
      meters: { m: meter.f32() },
    }));
    const plan = planLayout(spec);

    // Mock WebAssembly.Memory to throw immediately upon instantiation
    class ThrowingMemory {
      constructor(_desc: WebAssembly.MemoryDescriptor) {
        throw new Error("Simulated internal Wasm allocation failure");
      }

      // Property required to satisfy type definition, though unreachable here
      get buffer(): ArrayBuffer {
        return new ArrayBuffer(0);
      }
    }

    vi.stubGlobal("WebAssembly", {
      Memory: ThrowingMemory as unknown as typeof WebAssembly.Memory,
    } as unknown as typeof WebAssembly);

    let thrown: unknown;

    try {
      allocateWasmShared(plan);
    } catch (e) {
      thrown = e;
    }

    // Verify the error was caught, wrapped, and typed correctly
    if (!isSeqlokError(thrown)) {
      throw new Error("Expected allocateWasmShared to throw a SeqlokError");
    }

    expect(thrown.code).toBe("backing.wasmMemoryNotShared");
    expect(thrown.message).toMatch(
      /Failed to attach shared WebAssembly\.Memory/i,
    );
    expect(thrown.details.where).toBe("allocateWasmShared");
  });
});
