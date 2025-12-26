import { isSeqlokError } from "@seqlok/base";
import { describe, it, expect, afterEach } from "vitest";

import {
  exportIntrospectCounters,
  resetCounters,
  setCounter,
  snapshotCounters,
} from "../src";

afterEach(() => {
  resetCounters();
});

describe("exportIntrospectCounters (usage)", () => {
  it("exports Prometheus text with HELP/TYPE and optional TIMESTAMP", () => {
    setCounter("spinBudgetExhausted", 3);
    const snapshot = snapshotCounters();

    const text = exportIntrospectCounters(snapshot, {
      format: "prometheus",
      includeTimestamp: true,
      metricPrefix: "seqlok_introspect",
    });

    expect(text).toContain("# HELP seqlok_introspect_spinBudgetExhausted");
    expect(text).toContain(
      "# TYPE seqlok_introspect_spinBudgetExhausted counter",
    );
    expect(text).toContain("seqlok_introspect_spinBudgetExhausted 3");
    expect(text).toContain("# TIMESTAMP ");
  });

  it("throws a SeqlokError for invalid counter snapshots (negative/NaN)", () => {
    const bad = {
      degradedSnapshots: 0,
      spinBudgetExhausted: -1,
      retryBudgetExhausted: Number.NaN,
    };

    try {
      exportIntrospectCounters(bad, { format: "json" });
      expect.fail("expected exportIntrospectCounters to throw");
    } catch (e: unknown) {
      expect(isSeqlokError(e)).toBe(true);
      if (isSeqlokError(e)) {
        expect(e.code).toBe("introspect.counterInvalid");
      }
    }
  });
});
