import { describe, expect, it } from "vitest";

import { allocateSharedPartitioned } from "../../src/backing/allocate-shared-partitioned";
import { getBackingBuffer } from "../../src/backing/buffers";
import { SeqlokError } from "../../src/errors/error";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

describe("getBackingBuffer: Partitioned Backing Restrictions", () => {
  it("throws an internal.assertionFailed error", () => {
    const spec = defineSpec(({ param, meter }) => ({
      params: {
        rate: param.f32(),
      },
      meters: {
        level: meter.f32(),
      },
    }));

    const plan = planLayout(spec);
    const backing = allocateSharedPartitioned(plan);

    // Assert that the generic error type is correct
    expect(() => getBackingBuffer(backing)).toThrow(SeqlokError);

    // Inspect specific error codes and details
    try {
      getBackingBuffer(backing);
    } catch (error) {
      const err = error as SeqlokError;

      // Partitioned backings split memory across multiple independent buffers (planes).
      // Therefore, requesting a single global SharedArrayBuffer is a logic error.
      expect(err.code).toBe("internal.assertionFailed");
      expect(err.details.where).toBe("backing.getBackingBuffer");
    }
  });
});
