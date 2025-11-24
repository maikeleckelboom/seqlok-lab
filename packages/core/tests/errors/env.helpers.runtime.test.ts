import { describe, expect, it } from "vitest";

import { isSeqlokError } from "../../src/errors/error";
import { throwEnvUnsupported } from "../../src/errors/helpers";

import type { EnvUnsupportedDetails } from "../../src/errors/codes/env";

describe("throwEnvUnsupported", () => {
  it("throws an env.unsupported error with structured details", () => {
    const feature: EnvUnsupportedDetails["feature"] = "SharedArrayBuffer";
    const reason = "globalThis.SharedArrayBuffer is missing";
    const cause = new Error("test sentinel");

    try {
      throwEnvUnsupported(feature, reason, cause);
    } catch (err) {
      if (!isSeqlokError(err)) {
        expect.unreachable("expected a SeqlokError");
      }

      expect(err.code).toBe("env.unsupported");

      const details = err.details as EnvUnsupportedDetails;
      expect(details.feature).toBe(feature);
      expect(details.reason).toBe(reason);

      expect(err.cause).toBe(cause);
    }
  });
});
