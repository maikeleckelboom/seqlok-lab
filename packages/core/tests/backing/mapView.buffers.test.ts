import { describe, expect, it } from "vitest";

import { mapViews } from "../../src/backing/map-views";
import { planLayout } from "../../src/plan/layout";
import { specFromPlaneBytes } from "../helpers/spec-from-bytes";

import type { SharedBacking, WasmSharedBacking } from "../../src/backing/types";
import type { PlaneByteLengths } from "../../src/plan/types";

const BYTES_F32 = 4;
const WASM_PAGE_SIZE = 64 * 1024;

describe("Map Views: Buffer Identity & Shared Memory Wiring", () => {
  it("ensures all mapped views share the same underlying SharedArrayBuffer in contiguous mode", () => {
    // Define a minimal layout with gaps (zero-length planes) to verify robust plumbing
    const bytes: PlaneByteLengths = {
      PF32: 8 * BYTES_F32,
      PI32: 0,
      PB: 0,
      PU: 2 * BYTES_F32,
      MF32: 0,
      MF64: 0,
      MU32: 0,
      MU: 2 * BYTES_F32,
    };

    const plan = planLayout(specFromPlaneBytes(bytes));
    const sab = new SharedArrayBuffer(plan.bytesTotal);
    const backing: SharedBacking = { kind: "shared", sab };

    const v = mapViews(plan, backing);

    // Verify referential identity: checks that views are "windows" into the exact same buffer
    expect(v.params.PF32.buffer).toBe(sab);
    expect(v.params.PU.buffer).toBe(sab);
    expect(v.locks.MU.buffer).toBe(sab);
  });

  it("ensures WebAssembly shared memory views are correctly mapped and backed by the Wasm buffer", () => {
    const bytes: PlaneByteLengths = {
      PF32: 8 * BYTES_F32,
      PI32: 4 * BYTES_F32,
      PB: 7,
      PU: 2 * BYTES_F32,
      MF32: 6 * BYTES_F32,
      MF64: 8,
      MU32: 3 * BYTES_F32,
      MU: 2 * BYTES_F32,
    };

    const plan = planLayout(specFromPlaneBytes(bytes));
    const pages = Math.ceil(plan.bytesTotal / WASM_PAGE_SIZE);

    const memory = new WebAssembly.Memory({
      shared: true,
      initial: pages,
      maximum: pages,
    });
    const wasm: WasmSharedBacking = { kind: "wasm-shared", memory };

    const v = mapViews(plan, wasm);

    // Verify buffer identity (zero-copy)
    expect(v.params.PF32.buffer).toBe(memory.buffer);

    // Verify view dimensions match the plan
    expect(v.params.PF32.byteLength).toBe(plan.planes.PF32);
    expect(v.params.PI32.byteLength).toBe(plan.planes.PI32);
    expect(v.params.PB.byteLength).toBe(plan.planes.PB);
    expect(v.params.PU.byteLength).toBe(plan.planes.PU);
    expect(v.meters.MF32.byteLength).toBe(plan.planes.MF32);
    expect(v.meters.MF64.byteLength).toBe(plan.planes.MF64);
    expect(v.meters.MU32.byteLength).toBe(plan.planes.MU32);
    expect(v.locks.MU.byteLength).toBe(plan.planes.MU);
  });
});
