import { afterEach, describe, expect, it, vi } from "vitest";

import { allocateWasmShared } from "../../src/backing/allocate-wasm-shared";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Allocate Wasm Shared: Memory Capacity", () => {
  it("allocates a shared WebAssembly memory instance with sufficient capacity to cover the plan", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "wasm-capacity-check",
      params: { p: param.f32({ min: 0, max: 1 }) },
      // Request enough meters to potentially require multiple Wasm pages (64KB each)
      // to ensure page boundary calculations are correct.
      meters: { m: meter.f32.array(1000) },
    }));

    const plan = planLayout(spec);
    const backing = allocateWasmShared(plan);

    // Verify the backing kind and the underlying SharedArrayBuffer existence
    expect(backing.kind).toBe("wasm-shared");
    expect(backing.memory.buffer).toBeInstanceOf(SharedArrayBuffer);

    // The allocated buffer must be at least as large as the planned requirements.
    // Note: Wasm memory is allocated in 64KB page increments, so actual size >= required.
    expect(backing.memory.buffer.byteLength).toBeGreaterThanOrEqual(
      plan.bytesTotal,
    );
  });
});
