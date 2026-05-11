import { describe, expect, it } from "vitest";

import { defineSpec } from "../../src/spec/define";

import type { SpecAstInput } from "@seqlok/schema";

describe("defineSpec authored-schema authority path", () => {
  it("accepts a plain AST typed from @seqlok/schema and produces a resolved spec", () => {
    const ast = {
      id: "transport",
      params: {
        tempo: { kind: "f32", min: 40, max: 240 },
        mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] },
      },
      meters: {
        level: { kind: "f32" },
      },
    } as const satisfies SpecAstInput;

    const spec = defineSpec(ast);

    expect(spec.id).toBe("transport");
    expect(spec.params.tempo).toEqual({ kind: "f32", min: 40, max: 240 });
    expect(spec.params.mode).toEqual({
      kind: "enum",
      values: ["vinyl", "cdj", "sync"],
    });
    expect(spec.meters).toBeDefined();
    expect(spec.meters.level).toEqual({ kind: "f32" });
  });

  it("accepts a nested namespace AST from @seqlok/schema and flattens it", () => {
    const ast = {
      params: {
        transport: {
          tempo: { kind: "f32", min: 40, max: 240 },
        },
      },
    } as const satisfies SpecAstInput;

    const spec = defineSpec(ast);

    expect(spec.params["transport.tempo"]).toEqual({
      kind: "f32",
      min: 40,
      max: 240,
    });
  });

  it("builder DSL and plain AST produce equivalent resolved specs", () => {
    const ast = {
      id: "eq-test",
      params: {
        gain: { kind: "f32" },
        mode: { kind: "enum", values: ["vinyl", "cdj"] },
      },
      meters: {
        level: { kind: "f64" },
      },
    } as const satisfies SpecAstInput;

    const fromAst = defineSpec(ast);
    const fromBuilder = defineSpec(({ param, meter }) => ({
      id: "eq-test",
      params: {
        gain: param.f32(),
        mode: param.enum(["vinyl", "cdj"]),
      },
      meters: {
        level: meter.f64(),
      },
    }));

    expect(fromAst.id).toBe("eq-test");
    expect(fromAst.id).toBe(fromBuilder.id);
    expect(Object.keys(fromAst.params as Record<string, unknown>)).toEqual(
      Object.keys(fromBuilder.params as Record<string, unknown>),
    );
    expect(Object.keys(fromAst.meters as Record<string, unknown>)).toEqual(
      Object.keys(fromBuilder.meters as Record<string, unknown>),
    );
    expect(fromAst.params).toEqual(fromBuilder.params);
    expect(fromAst.meters).toEqual(fromBuilder.meters);
  });
});
