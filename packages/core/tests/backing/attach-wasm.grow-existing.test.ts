import { describe, it, expect } from "vitest";

import { allocateWasmShared } from "../../src/backing/allocate-wasm-shared";
import { isSeqlokError } from "../../src/errors/error";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

const WASM_PAGE_SIZE = 64 * 1024;

class GrowingFakeMemory {
  private _buffer: SharedArrayBuffer;
  growCallCount = 0;
  lastGrowDeltaPages: number | undefined;

  constructor(initialBytes: number) {
    this._buffer = new SharedArrayBuffer(initialBytes);
  }

  get buffer(): SharedArrayBuffer {
    return this._buffer;
  }

  grow(deltaPages: number): number {
    this.growCallCount += 1;
    this.lastGrowDeltaPages = deltaPages;

    const oldBytes = this._buffer.byteLength;
    const newBytes = oldBytes + deltaPages * WASM_PAGE_SIZE;

    this._buffer = new SharedArrayBuffer(newBytes);

    // Emulate real API: return previous page count
    return Math.floor(oldBytes / WASM_PAGE_SIZE);
  }
}

class FailingGrowFakeMemory {
  private readonly _buffer: SharedArrayBuffer;

  constructor(initialBytes: number) {
    this._buffer = new SharedArrayBuffer(initialBytes);
  }

  get buffer(): SharedArrayBuffer {
    return this._buffer;
  }

  grow(_deltaPages: number): number {
    // Simulate hitting maximum pages or similar engine limitation
    throw new RangeError("maximum memory reached");
  }
}

describe("Allocate Wasm Shared: existing memory growth", () => {
  it("grows undersized existing memory until it satisfies plan.bytesTotal", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "wasm-grow-existing",
      params: {
        p: param.f32({ min: 0, max: 1 }),
      },
      meters: {
        m: meter.f32(),
      },
    }));

    const plan = planLayout(spec);

    // Start strictly undersized so ensureWasmCapacity must call grow()
    const undersizedBytes = Math.max(1, plan.bytesTotal - WASM_PAGE_SIZE / 2);

    const fake = new GrowingFakeMemory(undersizedBytes);
    const memory = fake as unknown as WebAssembly.Memory;

    const backing = allocateWasmShared(plan, memory);

    expect(backing.kind).toBe("wasm-shared");
    expect(backing.memory).toBe(memory);

    // We should have grown at least once
    expect(fake.growCallCount).toBe(1);
    expect(fake.lastGrowDeltaPages).toBeGreaterThanOrEqual(1);

    // After growth, buffer must be large enough for the plan
    expect(fake.buffer.byteLength).toBeGreaterThanOrEqual(plan.bytesTotal);
  });

  it("maps growth failure into backing.allocUndersized with requested/allocated details", () => {
    const spec = defineSpec(({ param, meter }) => ({
      id: "wasm-grow-fail",
      params: {
        p: param.f32({ min: 0, max: 1 }),
      },
      meters: {
        m: meter.f32(),
      },
    }));

    const plan = planLayout(spec);

    const undersizedBytes = Math.max(1, plan.bytesTotal - WASM_PAGE_SIZE / 2);

    const failing = new FailingGrowFakeMemory(undersizedBytes);
    const memory = failing as unknown as WebAssembly.Memory;

    let thrown: unknown;

    try {
      allocateWasmShared(plan, memory);
    } catch (error) {
      thrown = error;
    }

    if (thrown === undefined) {
      throw new Error("Expected allocateWasmShared to throw for grow failure");
    }

    if (!isSeqlokError(thrown)) {
      throw thrown as Error;
    }

    expect(thrown.code).toBe("backing.allocUndersized");
    expect(thrown.details.where).toBe("allocateWasmShared.grow");

    if (
      "requestedBytes" in thrown.details &&
      "allocatedBytes" in thrown.details
    ) {
      expect(thrown.details.requestedBytes).toBe(plan.bytesTotal);
      expect(thrown.details.allocatedBytes).toBe(undersizedBytes);
    }
  });
});
