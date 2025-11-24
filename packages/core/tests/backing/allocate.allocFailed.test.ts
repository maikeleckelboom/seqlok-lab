import { describe, expect, it } from "vitest";

import { createError } from "../../src/errors/error";

describe("SeqlokError Factory: Runtime Composition", () => {
  it("correctly composes error messages and preserves the underlying cause", () => {
    const cause = new TypeError("shared memory not supported");

    const se = createError(
      "backing.wasmMemoryNotShared",
      "Allocated WebAssembly.Memory is not shared",
      {
        detail: "memory.buffer is not a SharedArrayBuffer",
        plane: "wasm",
        shared: false,
      },
      cause,
    );

    expect(se.code).toBe("backing.wasmMemoryNotShared");
    expect(se.message).toMatch(/not shared/i);
    expect(se.details.detail).toMatch(/SharedArrayBuffer/i);
    expect(se.cause).toBe(cause);
  });

  it('constructs "env.unsupported" errors with structured feature details', () => {
    const se = createError("env.unsupported", "Feature unavailable", {
      feature: "SharedArrayBuffer",
      reason: "Missing COOP/COEP",
    });

    expect(se.code).toBe("env.unsupported");
    expect(se.message).toMatch(/Feature unavailable/i);
    expect(se.details.feature).toBe("SharedArrayBuffer");
    expect(se.details.reason).toMatch(/COOP\/COEP/i);
  });
});
