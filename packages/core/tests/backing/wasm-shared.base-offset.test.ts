import { describe, expect, it } from "vitest";

import {
  allocateWasmShared,
  bindController,
  defineSpec,
  planLayout,
} from "../../src";
import { computeBackingPlaneBases } from "../../src/backing/map-views";

const wasmSharedSupported = (() => {
  try {
    // Node/WebKit can throw if shared memories aren’t enabled.
    // We only need to know if the runtime supports it at all.
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return true;
  } catch {
    return false;
  }
})();

describe("wasm-shared baseOffsetBytes", () => {
  it.skipIf(!wasmSharedSupported)(
    "shifts mapped views by baseOffsetBytes and keeps the prefix untouched",
    () => {
      const spec = defineSpec({
        params: {
          gain: { kind: "f32", min: 0, max: 1 },
        },
      });

      const plan = planLayout(spec);

      const baseOffsetBytes = 8;

      // Your new API: allocate wasm-shared with an opt-in base offset.
      const backing = allocateWasmShared(plan, { baseOffsetBytes });

      const controller = bindController(spec, plan, backing);

      // Sanity: prefix should start all zeros.
      const prefixBefore = new Uint8Array(
        backing.memory.buffer,
        0,
        baseOffsetBytes,
      );
      expect(prefixBefore.every((b) => b === 0)).toBe(true);

      controller.params.set("gain", 0.5);

      // Prefix must remain untouched after writes.
      const prefixAfter = new Uint8Array(
        backing.memory.buffer,
        0,
        baseOffsetBytes,
      );
      expect(prefixAfter.every((b) => b === 0)).toBe(true);

      const bases = computeBackingPlaneBases(plan.planes);
      const gainSlot = plan.params.gain;

      const gainByteOffset =
        baseOffsetBytes + bases[gainSlot.plane] + gainSlot.offset;

      const gain = new Float32Array(backing.memory.buffer, gainByteOffset, 1);
      expect(gain[0]).toBeCloseTo(0.5, 6);

      // Thhe “no offset” location should still read as 0.0 (because the real write shifted).
      const gainNoBase = new Float32Array(
        backing.memory.buffer,
        bases[gainSlot.plane] + gainSlot.offset,
        1,
      );
      expect(gainNoBase[0]).toBe(0);

      controller.dispose();
    },
  );

  it.skipIf(!wasmSharedSupported)(
    "rejects non-8-byte-aligned baseOffsetBytes",
    () => {
      const spec = defineSpec({
        params: {
          gain: { kind: "f32", min: 0, max: 1 },
        },
      });

      const plan = planLayout(spec);

      expect(() => allocateWasmShared(plan, { baseOffsetBytes: 4 })).toThrow();
    },
  );
});
