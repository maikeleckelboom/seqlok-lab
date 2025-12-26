import { describe, expect, it } from "vitest";

import {
  buildFullErrorRegistryJson,
  computeNumericCode,
  listErrors,
  type ErrorRegistryJson,
  type ExportedError,
} from "../src";

function flatten(exported: ErrorRegistryJson): readonly ExportedError[] {
  const all: ExportedError[] = [];
  for (const domain of exported.domains) {
    all.push(...domain.errors);
  }
  return all;
}

describe("error registry export (usage)", () => {
  it("exports a registry JSON containing introspect errors with stable numeric codes", () => {
    const exported = buildFullErrorRegistryJson();

    // pick a known introspect code from the aggregated index
    const indexed = listErrors().filter((e) => e.domain === "introspect");
    expect(indexed.length).toBeGreaterThan(0);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const pick = indexed[0]!;
    const numeric = computeNumericCode(pick.code);

    expect(numeric).toBeDefined();
    expect(numeric).toBe(pick.numericCode);

    const found = flatten(exported).find((e) => e.code === pick.code);
    if (found === undefined) {
      throw new Error(`exported registry missing code: ${pick.code}`);
    }

    expect(found.numericCode).toBe(pick.numericCode);
    expect(found.key.length).toBeGreaterThan(0);
    expect(found.message.length).toBeGreaterThan(0);
  });

  it("includes an introspect domains entry in the exported domains list", () => {
    const exported = buildFullErrorRegistryJson();

    const introspectDomain = exported.domains.find(
      (d) => d.prefix === "introspect",
    );
    if (introspectDomain === undefined) {
      throw new Error(`exported registry missing domain: introspect`);
    }

    expect(introspectDomain.errors.length).toBeGreaterThan(0);
  });
});
