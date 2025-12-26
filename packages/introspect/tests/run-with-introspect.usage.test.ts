import {
  getDocsUrl,
  interpretHealth,
  isBoundarySafe,
  isSeqlokError,
} from "@seqlok/base";
import { describe, expect, it } from "vitest";

import {
  checkIntrospectThresholds,
  type CoreIntrospectEventContext,
  createIntrospectBudgets,
  exportIntrospectCounters,
  installCoreIntrospectSink,
  type IntrospectCountersSnapshot,
  type IntrospectThresholds,
  recordIntrospectCounter,
  runWithIntrospect,
  runWithIntrospectSync,
} from "../src";

function makeCtx(
  where: string,
  section?: CoreIntrospectEventContext["section"],
): CoreIntrospectEventContext {
  return section === undefined ? { where } : { where, section };
}

function mustRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a record`);
  }
  return value as Record<string, unknown>;
}

function mustNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function parseCsvByName(csv: string): {
  header: string;
  rowsByName: Map<string, { value: string; timestamp?: string }>;
} {
  const lines = csv.split("\n").filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error("csv must contain header + at least one row");
  }

  const header = lines[0] ?? "";
  const hasTimestamp = header.split(",").includes("timestamp");

  const rowsByName = new Map<string, { value: string; timestamp?: string }>();
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const name = parts[0];
    const value = parts[1];

    if (name === undefined || value === undefined) {
      throw new Error(`invalid csv row: ${line}`);
    }

    if (hasTimestamp) {
      const ts = parts[2];
      if (ts === undefined) {
        throw new Error(`csv row missing timestamp: ${line}`);
      }
      rowsByName.set(name, { value, timestamp: ts });
    } else {
      rowsByName.set(name, { value });
    }
  }

  return { header, rowsByName };
}

describe("runWithIntrospectSync (usage)", () => {
  it("captures counter increments via the installed sink and exports JSON with timestamp", () => {
    installCoreIntrospectSink(undefined);

    const result = runWithIntrospectSync(
      () => {
        recordIntrospectCounter("spinBudgetExhausted", makeCtx("test.run"));
        recordIntrospectCounter("spinBudgetExhausted", makeCtx("test.run"));
        recordIntrospectCounter(
          "retryBudgetExhausted",
          makeCtx("test.run", "params"),
        );
        return 123;
      },
      {
        scenarioId: "usage:sync",
        thresholds: { spinBudgetExhausted: 1 },
      },
    );

    expect(result.value).toBe(123);
    expect(result.error).toBeUndefined();

    expect(result.introspectCounters.spinBudgetExhausted).toBe(2);
    expect(result.introspectCounters.retryBudgetExhausted).toBe(1);

    const parsed = mustRecord(
      JSON.parse(result.introspectExportJson) as unknown,
      "introspectExportJson",
    );
    expect(mustNumber(parsed.timestamp, "timestamp")).toBeGreaterThan(0);

    expect(result.thresholdViolations).toHaveLength(1);
    expect(result.thresholdViolations[0]?.metric).toBe("spinBudgetExhausted");
    expect(result.thresholdViolations[0]?.actual).toBe(2);
    expect(result.thresholdViolations[0]?.threshold).toBe(1);
  });

  it("records SeqlokError details and derives boundarySafe/docsUrl/health from meta", () => {
    installCoreIntrospectSink(undefined);

    const result = runWithIntrospectSync(
      () => {
        createIntrospectBudgets({ spinLimit: -1 });
        return "unreachable";
      },
      { scenarioId: "usage:seqlok-error" },
    );

    expect(result.value).toBeUndefined();
    expect(result.error).toBeTruthy();

    const err = result.error;
    if (!err) {
      return;
    }

    expect(isSeqlokError(err)).toBe(true);
    if (!isSeqlokError(err)) {
      return;
    }

    const meta = err.meta;

    expect(result.boundarySafe).toBe(isBoundarySafe(meta));
    expect(result.docsUrl).toBe(getDocsUrl(meta));
    expect(result.health).toEqual(interpretHealth(meta));
  });

  it("rethrows unknown errors but restores the prior sink", () => {
    let seen = 0;

    const prev = installCoreIntrospectSink({
      onCounterIncrement() {
        seen += 1;
      },
    });

    try {
      expect(() =>
        runWithIntrospectSync(
          () => {
            recordIntrospectCounter("spinBudgetExhausted", makeCtx("before"));
            throw new Error("boom");
          },
          { scenarioId: "usage:unknown-error" },
        ),
      ).toThrowError("boom");

      recordIntrospectCounter("spinBudgetExhausted", makeCtx("after-1"));
      recordIntrospectCounter("spinBudgetExhausted", makeCtx("after-2"));

      expect(seen).toBe(2);
    } finally {
      installCoreIntrospectSink(prev);
    }
  });
});

describe("runWithIntrospect (async usage)", () => {
  it("works the same for async flows without requiring an await in the callback", async () => {
    installCoreIntrospectSink(undefined);

    const thresholds: IntrospectThresholds = {
      retryBudgetExhausted: 0,
    };

    const result = await runWithIntrospect(
      () => {
        recordIntrospectCounter("retryBudgetExhausted", makeCtx("async.run"));
        return Promise.resolve("ok");
      },
      { scenarioId: "usage:async", thresholds },
    );

    expect(result.value).toBe("ok");
    expect(result.error).toBeUndefined();
    expect(result.introspectCounters.retryBudgetExhausted).toBe(1);

    expect(result.thresholdViolations).toHaveLength(1);
    expect(result.thresholdViolations[0]?.metric).toBe("retryBudgetExhausted");
    expect(result.thresholdViolations[0]?.actual).toBe(1);
    expect(result.thresholdViolations[0]?.threshold).toBe(0);
  });
});

describe("checkIntrospectThresholds (usage)", () => {
  it("reports violations for a given snapshot", () => {
    const snapshot: IntrospectCountersSnapshot = {
      degradedSnapshots: 0,
      spinBudgetExhausted: 1,
      retryBudgetExhausted: 0,
    };

    const violations = checkIntrospectThresholds(snapshot, {
      spinBudgetExhausted: 0,
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.metric).toBe("spinBudgetExhausted");
    expect(violations[0]?.actual).toBe(1);
    expect(violations[0]?.threshold).toBe(0);
  });
});

describe("exportIntrospectCounters (usage)", () => {
  it("exports JSON with timestamp when includeTimestamp is true", () => {
    const snapshot: IntrospectCountersSnapshot = {
      degradedSnapshots: 1,
      spinBudgetExhausted: 2,
      retryBudgetExhausted: 3,
    };

    const json = exportIntrospectCounters(snapshot, {
      format: "json",
      includeTimestamp: true,
    });

    const parsed = mustRecord(JSON.parse(json) as unknown, "export json");
    expect(mustNumber(parsed.timestamp, "timestamp")).toBeGreaterThan(0);

    expect(parsed.degradedSnapshots).toBe(1);
    expect(parsed.spinBudgetExhausted).toBe(2);
    expect(parsed.retryBudgetExhausted).toBe(3);
  });

  it("exports Prometheus text with TYPE lines and optional metricPrefix + timestamp", () => {
    const snapshot: IntrospectCountersSnapshot = {
      degradedSnapshots: 0,
      spinBudgetExhausted: 3,
      retryBudgetExhausted: 0,
    };

    const text = exportIntrospectCounters(snapshot, {
      format: "prometheus",
      metricPrefix: "seqlok_introspect",
      includeTimestamp: true,
    });

    // Don’t lock down the HELP message body; just prove the metric exists.
    expect(text).toContain(
      "# TYPE seqlok_introspect_spinBudgetExhausted counter",
    );
    expect(text).toContain("seqlok_introspect_spinBudgetExhausted 3");

    expect(text).toMatch(/# TIMESTAMP \d+/);
  });

  it("exports CSV with header and optional timestamp column", () => {
    const snapshot: IntrospectCountersSnapshot = {
      degradedSnapshots: 4,
      spinBudgetExhausted: 5,
      retryBudgetExhausted: 6,
    };

    const csv = exportIntrospectCounters(snapshot, {
      format: "csv",
      includeTimestamp: true,
    });

    const { header, rowsByName } = parseCsvByName(csv);
    expect(header).toBe("name,value,timestamp");

    const row = rowsByName.get("degradedSnapshots");
    expect(row).toBeTruthy();
    if (!row) {
      return;
    }

    expect(row.value).toBe("4");
    expect(row.timestamp).toMatch(/^\d+$/);
  });

  it("throws SeqlokError<'introspect.counterInvalid'> for invalid snapshots (negative / non-finite)", () => {
    const bad: IntrospectCountersSnapshot = {
      degradedSnapshots: 0,
      spinBudgetExhausted: -1,
      retryBudgetExhausted: 0,
    };

    try {
      exportIntrospectCounters(bad, { format: "json" });
      expect.fail("expected exportIntrospectCounters to throw");
    } catch (e: unknown) {
      expect(isSeqlokError(e)).toBe(true);
      if (!isSeqlokError(e)) {
        return;
      }

      expect(e.code).toBe("introspect.counterInvalid");

      const meta = mustRecord(e.meta as unknown, "error.meta");
      expect(meta.severity).toBeDefined();
    }
  });
});
