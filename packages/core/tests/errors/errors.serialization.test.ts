import { describe, expect, it } from "vitest";

import {
  createError,
  isSeqlokError,
  type SeqlokError,
} from "../../src/errors/error";

describe("SeqlokError: Serialization & Type Identity", () => {
  it("serializes to a minimal, stable JSON structure omitting sensitive details and causes", () => {
    const err = createError("backing.wasmMemoryNotShared", "wrapped", {
      detail: "WebAssembly.Memory.buffer is not SharedArrayBuffer",
      plane: "wasm",
      shared: false,
    });

    expect(isSeqlokError(err)).toBe(true);

    // Simulate the serialization/deserialization cycle
    const json = JSON.parse(JSON.stringify(err)) as ReturnType<
      SeqlokError["toJSON"]
    >;

    // Verify core identity fields
    expect(json.name).toBe("SeqlokError");
    expect(json.code).toBe("backing.wasmMemoryNotShared");
    expect(typeof json.message).toBe("string");

    // Ensure structural strictness: Only safe, standard fields should remain.
    // Internal details and nested causes are stripped to prevent leakages in logs.
    const keys = Object.keys(json).sort();
    expect(keys).toEqual(["code", "message", "name"]);

    expect("payload" in json).toBe(false);
    expect("cause" in json).toBe(false);
  });

  it("correctly distinguishes SeqlokError instances from generic errors and plain objects", () => {
    const seqlokErr = createError("env.unsupported", "Feature unavailable", {
      feature: "SharedArrayBuffer",
      reason: "Missing COOP/COEP",
    });

    // Positive validation
    expect(isSeqlokError(seqlokErr)).toBe(true);

    // Negative validation cases
    const genericError = new Error("Standard JS Error");
    const mimickedShape = {
      name: "Error", // Fails branding check
      message: "nope",
      code: "env.unsupported",
    };
    const nullValue = null;
    const primitiveValue = 42;

    expect(isSeqlokError(genericError)).toBe(false);
    expect(isSeqlokError(mimickedShape)).toBe(false);
    expect(isSeqlokError(nullValue)).toBe(false);
    expect(isSeqlokError(primitiveValue)).toBe(false);
  });
});
