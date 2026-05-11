import { describe, expect, it } from "vitest";

// eslint-disable-next-line import/extensions
import schemaDocument from "../spec-ast/v1.json";
import {
  normalizeSpecAst,
  validateSpecAst,
  SchemaValidationError,
  SPEC_AST_V1_ID,
} from "../src/index";

import type { MeterDef, ParamDef, SpecAstInput } from "../src/index";

describe("SPEC_AST_V1_ID", () => {
  it("is the stable v1 schema identifier", () => {
    expect(SPEC_AST_V1_ID).toBe("https://seqlok.dev/schema/spec-ast/v1.json");
  });
});

describe("published schema artifact drift", () => {
  it("keeps the exported $id aligned with the published JSON schema", () => {
    expect(schemaDocument.$id).toBe(SPEC_AST_V1_ID);
  });

  it("keeps top-level $schema support aligned across artifact and validator", () => {
    const properties = schemaDocument.properties as Record<
      string,
      { type?: string; minLength?: number }
    >;

    expect(properties.$schema).toBeDefined();
    expect(properties.$schema?.type).toBe("string");
    expect(properties.$schema?.minLength).toBe(1);

    expect(() =>
      validateSpecAst({
        $schema: SPEC_AST_V1_ID,
        params: { gain: { kind: "f32" } },
      }),
    ).not.toThrow();
  });
});

describe("normalizeSpecAst", () => {
  it("preserves top-level $schema when present", () => {
    const normalized = normalizeSpecAst({
      $schema: SPEC_AST_V1_ID,
      params: { gain: { kind: "f32" } },
    });

    expect(normalized.$schema).toBe(SPEC_AST_V1_ID);
  });

  it("sorts top-level keys deterministically", () => {
    const a = normalizeSpecAst({
      meters: { level: { kind: "f32" } },
      params: { gain: { kind: "f32" } },
      id: "spec-a",
    });
    const b = normalizeSpecAst({
      id: "spec-a",
      params: { gain: { kind: "f32" } },
      meters: { level: { kind: "f32" } },
    });

    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual(["id", "params", "meters"]);
  });

  it("sorts namespace keys deterministically at every level", () => {
    const a = normalizeSpecAst({
      params: {
        z: { kind: "f32" },
        a: { kind: "i32" },
      },
    });
    const b = normalizeSpecAst({
      params: {
        a: { kind: "i32" },
        z: { kind: "f32" },
      },
    });

    expect(a).toEqual(b);
    expect(Object.keys(a.params as Record<string, unknown>)).toEqual([
      "a",
      "z",
    ]);
  });

  it("sorts nested namespace keys deterministically", () => {
    const a = normalizeSpecAst({
      params: {
        transport: {
          tempo: { kind: "f32" },
          swing: { kind: "f32" },
        },
      },
    });
    const b = normalizeSpecAst({
      params: {
        transport: {
          swing: { kind: "f32" },
          tempo: { kind: "f32" },
        },
      },
    });

    expect(a).toEqual(b);
    expect(Object.keys(a.params as Record<string, unknown>)).toEqual([
      "transport",
    ]);
    expect(
      Object.keys(
        (a.params as Record<string, unknown>).transport as Record<
          string,
          unknown
        >,
      ),
    ).toEqual(["swing", "tempo"]);
  });

  it("preserves enum vocabulary order", () => {
    const a = normalizeSpecAst({
      params: {
        mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] },
      },
    });

    expect(a.params).toBeDefined();
    const mode = (a.params as Record<string, unknown>).mode as {
      kind: "enum";
      values: readonly string[];
    };
    expect(mode.values).toEqual(["vinyl", "cdj", "sync"]);
  });

  it("omits empty params and meters", () => {
    const a = normalizeSpecAst({ id: "empty" });
    expect(a.params).toBeUndefined();
    expect(a.meters).toBeUndefined();
    expect(a.id).toBe("empty");
  });

  it("omits id when undefined", () => {
    const a = normalizeSpecAst({
      params: { gain: { kind: "f32" } },
    });
    expect(a.id).toBeUndefined();
  });

  it("normalizes equivalent authored objects identically", () => {
    const a = normalizeSpecAst({
      params: {
        transport: {
          tempo: { kind: "f32", min: 40, max: 240 },
          mode: { kind: "enum", values: ["a", "b"] },
        },
      },
      meters: {
        level: { kind: "f32" },
      },
    });

    const b = normalizeSpecAst({
      meters: {
        level: { kind: "f32" },
      },
      params: {
        transport: {
          mode: { kind: "enum", values: ["a", "b"] },
          tempo: { kind: "f32", min: 40, max: 240 },
        },
      },
    });

    expect(a).toEqual(b);
  });

  it("preserves array length and numeric range fields", () => {
    const a = normalizeSpecAst({
      params: {
        buf: { kind: "f32.array", length: 16 },
        gain: { kind: "f32", min: 0, max: 1 },
      },
    });

    const params = a.params as Record<string, unknown>;
    expect((params.buf as { length: number }).length).toBe(16);
    expect((params.gain as { min: number; max: number }).min).toBe(0);
    expect((params.gain as { min: number; max: number }).max).toBe(1);
  });

  it("round-trips through JSON serialization", () => {
    const ast: SpecAstInput = {
      $schema: SPEC_AST_V1_ID,
      id: "round-trip",
      params: {
        transport: {
          tempo: { kind: "f32", min: 40, max: 240 },
          mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] },
        },
        gain: { kind: "f32" },
      },
      meters: {
        level: { kind: "f64" },
      },
    };

    const normalized = normalizeSpecAst(ast);
    const json = JSON.stringify(normalized);
    const parsed = JSON.parse(json) as SpecAstInput;
    const renormalized = normalizeSpecAst(parsed);

    expect(renormalized).toEqual(normalized);
  });

  it("rejects invalid input instead of silently erasing unknown leaf properties", () => {
    const bad = {
      params: {
        gain: { kind: "f32", rogue: 1 },
      },
    } as unknown as SpecAstInput;

    expect(() => normalizeSpecAst(bad)).toThrow(SchemaValidationError);
  });
});

describe("validateSpecAst", () => {
  it("accepts a minimal valid spec", () => {
    expect(() =>
      validateSpecAst({
        params: {
          gain: { kind: "f32" },
        },
      }),
    ).not.toThrow();
  });

  it("accepts a fully populated valid spec", () => {
    expect(() =>
      validateSpecAst({
        $schema: SPEC_AST_V1_ID,
        id: "full-spec",
        params: {
          gain: { kind: "f32", min: 0, max: 1 },
          mode: { kind: "enum", values: ["a", "b"] },
          buf: { kind: "f32.array", length: 8 },
          enumBuf: { kind: "enum.array", values: ["x", "y"], length: 4 },
        },
        meters: {
          level: { kind: "f64" },
          peaks: { kind: "f64.array", length: 2 },
        },
      }),
    ).not.toThrow();
  });

  it("accepts recursive namespaces", () => {
    expect(() =>
      validateSpecAst({
        params: {
          transport: {
            tempo: { kind: "f32" },
            swing: { kind: "f32" },
          },
        },
      }),
    ).not.toThrow();
  });

  it("accepts all param kinds", () => {
    const kinds: ParamDef[] = [
      { kind: "f32" },
      { kind: "i32" },
      { kind: "u32" },
      { kind: "bool" },
      { kind: "enum", values: ["a"] },
      { kind: "f32.array", length: 1 },
      { kind: "i32.array", length: 1 },
      { kind: "u32.array", length: 1 },
      { kind: "u8.array", length: 1 },
      { kind: "i8.array", length: 1 },
      { kind: "i16.array", length: 1 },
      { kind: "u16.array", length: 1 },
      { kind: "bool.array", length: 1 },
      { kind: "enum.array", values: ["a"], length: 1 },
    ];

    for (const def of kinds) {
      expect(() =>
        validateSpecAst({
          params: { x: def },
        }),
      ).not.toThrow();
    }
  });

  it("accepts all meter kinds", () => {
    const kinds: MeterDef[] = [
      { kind: "f32" },
      { kind: "f64" },
      { kind: "i32" },
      { kind: "u32" },
      { kind: "bool" },
      { kind: "enum", values: ["a"] },
      { kind: "f32.array", length: 1 },
      { kind: "f64.array", length: 1 },
      { kind: "i32.array", length: 1 },
      { kind: "u32.array", length: 1 },
      { kind: "u8.array", length: 1 },
      { kind: "i8.array", length: 1 },
      { kind: "i16.array", length: 1 },
      { kind: "u16.array", length: 1 },
      { kind: "bool.array", length: 1 },
      { kind: "enum.array", values: ["a"], length: 1 },
    ];

    for (const def of kinds) {
      expect(() =>
        validateSpecAst({
          meters: { x: def },
        }),
      ).not.toThrow();
    }
  });

  it("accepts deeply nested namespaces", () => {
    expect(() =>
      validateSpecAst({
        params: {
          level1: {
            level2: {
              level3: {
                deep: { kind: "f32" },
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("validateSpecAst returns true for valid input", () => {
    const result = validateSpecAst({
      id: "valid-spec",
      params: { gain: { kind: "f32" } },
    });
    expect(result).toBe(true);
  });

  it("rejects non-object spec", () => {
    expect(() => validateSpecAst("bad")).toThrow(SchemaValidationError);
  });

  it("rejects unknown top-level properties", () => {
    expect(() =>
      validateSpecAst({
        id: "ok",
        unknownProp: true,
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects empty string $schema", () => {
    expect(() =>
      validateSpecAst({
        $schema: "",
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects empty string id", () => {
    expect(() =>
      validateSpecAst({
        id: "",
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects invalid param kind", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "f64" } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects invalid meter kind", () => {
    expect(() =>
      validateSpecAst({
        meters: { x: { kind: "u8" } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects array def missing length", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "f32.array" } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects array def with non-positive length", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "f32.array", length: 0 } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects array def with fractional length", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "f32.array", length: 1.5 } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects u32 def with negative min", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "u32", min: -1 } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects u32 def with negative max", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "u32", max: -1 } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects enum def missing values", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "enum" } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects enum def with empty values", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "enum", values: [] } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects enum def with empty string in values", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "enum", values: ["a", ""] } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects enum def with duplicate values", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "enum", values: ["a", "a"] } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects enum.array def missing values", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "enum.array", length: 4 } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects unknown property on leaf def", () => {
    expect(() =>
      validateSpecAst({
        params: { x: { kind: "f32", unknown: 1 } },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects non-object namespace entry", () => {
    expect(() =>
      validateSpecAst({
        params: { x: 42 },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects non-object namespace", () => {
    expect(() =>
      validateSpecAst({
        params: 42,
      }),
    ).toThrow(SchemaValidationError);
  });

  it("reports multiple issues when possible", () => {
    try {
      validateSpecAst({
        id: "",
        params: { x: { kind: "f32.array", length: 0 } },
        unknownProp: true,
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      const e = err as SchemaValidationError;
      expect(e.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
