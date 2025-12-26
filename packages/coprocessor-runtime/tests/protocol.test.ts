import { describe, expect, test } from "vitest";

import { isCpMountMessage } from "../src/protocol";

function makeWasmBytesAb(): ArrayBuffer {
  const u8 = new Uint8Array(16);
  u8[0] = 0x00;
  u8[1] = 0x61;
  u8[2] = 0x73;
  u8[3] = 0x6d;
  return u8.buffer;
}

describe("protocol guards", () => {
  test("isCpMountMessage accepts a minimal mount message (ArrayBuffer)", () => {
    const msg: unknown = {
      type: "cp:mount",
      key: "k",
      seq: 123,
      wasmBytes: makeWasmBytesAb(),
      moduleOpts: { foo: 1 },
    };

    expect(isCpMountMessage(msg)).toBe(true);
  });

  test("isCpMountMessage accepts wasmBytes as Uint8Array view", () => {
    const ab = makeWasmBytesAb();
    const view = new Uint8Array(ab);

    const msg: unknown = {
      type: "cp:mount",
      key: "k",
      seq: 1,
      wasmBytes: view,
    };

    expect(isCpMountMessage(msg)).toBe(true);
  });

  test("isCpMountMessage rejects non-wasm bytes", () => {
    const bad = new Uint8Array(16);

    const msg: unknown = {
      type: "cp:mount",
      key: "k",
      seq: 1,
      wasmBytes: bad,
    };

    expect(isCpMountMessage(msg)).toBe(false);
  });
});
