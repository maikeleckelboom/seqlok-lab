/**
 * @fileoverview
 * Structural validation for authored spec AST objects.
 *
 * Validates structure only. Semantic meaning (e.g. min < max) is owned by
 * @seqlok/schema canonicalization via canonicalizeSpecAst.
 */

import type { SpecAstInput } from "./ast";

export interface SchemaValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class SchemaValidationError extends Error {
  readonly issues: readonly SchemaValidationIssue[];

  constructor(issues: readonly SchemaValidationIssue[]) {
    const message = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    super(message);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

const PARAM_KINDS = new Set<string>([
  "f32",
  "i32",
  "u32",
  "bool",
  "enum",
  "f32.array",
  "i32.array",
  "u32.array",
  "u8.array",
  "i8.array",
  "i16.array",
  "u16.array",
  "bool.array",
  "enum.array",
]);

const METER_KINDS = new Set<string>([
  "f32",
  "f64",
  "i32",
  "u32",
  "bool",
  "enum",
  "f32.array",
  "f64.array",
  "i32.array",
  "u32.array",
  "u8.array",
  "i8.array",
  "i16.array",
  "u16.array",
  "bool.array",
  "enum.array",
]);

const PARAM_SCALAR_KINDS = new Set<string>([
  "f32",
  "i32",
  "u32",
  "bool",
  "enum",
]);
const PARAM_ARRAY_KINDS = new Set<string>([
  "f32.array",
  "i32.array",
  "u32.array",
  "u8.array",
  "i8.array",
  "i16.array",
  "u16.array",
  "bool.array",
  "enum.array",
]);

const METER_SCALAR_KINDS = new Set<string>([
  "f32",
  "f64",
  "i32",
  "u32",
  "bool",
  "enum",
]);
const METER_ARRAY_KINDS = new Set<string>([
  "f32.array",
  "f64.array",
  "i32.array",
  "u32.array",
  "u8.array",
  "i8.array",
  "i16.array",
  "u16.array",
  "bool.array",
  "enum.array",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isValidEnumVocabulary(
  values: unknown,
  path: string,
  issues: SchemaValidationIssue[],
): boolean {
  if (!Array.isArray(values)) {
    issues.push({ path: `${path}.values`, message: "must be an array" });
    return false;
  }

  if (values.length === 0) {
    issues.push({ path: `${path}.values`, message: "must not be empty" });
    return false;
  }

  const seen = new Set<string>();
  for (let i = 0; i < values.length; i += 1) {
    const v: unknown = values[i];
    if (!isString(v) || v.length === 0) {
      issues.push({
        path: `${path}.values[${String(i)}]`,
        message: "must be a non-empty string",
      });
      return false;
    }
    if (seen.has(v)) {
      issues.push({
        path: `${path}.values[${String(i)}]`,
        message: "duplicate enum label",
      });
      return false;
    }
    seen.add(v);
  }

  return true;
}

function validateLeafDef(
  def: Record<string, unknown>,
  path: string,
  issues: SchemaValidationIssue[],
  allowedKinds: Set<string>,
  scalarKinds: Set<string>,
  arrayKinds: Set<string>,
): boolean {
  const kind = def.kind;
  if (!isString(kind)) {
    issues.push({ path: `${path}.kind`, message: "must be a string" });
    return false;
  }

  if (!allowedKinds.has(kind)) {
    issues.push({ path: `${path}.kind`, message: `unsupported kind: ${kind}` });
    return false;
  }

  const allowedKeys = new Set<string>(["kind"]);

  if (scalarKinds.has(kind)) {
    if (kind === "f32") {
      allowedKeys.add("min");
      allowedKeys.add("max");
      if ("min" in def && !isNumber(def.min)) {
        issues.push({ path: `${path}.min`, message: "must be a number" });
        return false;
      }
      if ("max" in def && !isNumber(def.max)) {
        issues.push({ path: `${path}.max`, message: "must be a number" });
        return false;
      }
    } else if (kind === "i32") {
      allowedKeys.add("min");
      allowedKeys.add("max");
      if ("min" in def && !isInteger(def.min)) {
        issues.push({ path: `${path}.min`, message: "must be an integer" });
        return false;
      }
      if ("max" in def && !isInteger(def.max)) {
        issues.push({ path: `${path}.max`, message: "must be an integer" });
        return false;
      }
    } else if (kind === "u32") {
      allowedKeys.add("min");
      allowedKeys.add("max");
      if ("min" in def) {
        if (!isInteger(def.min)) {
          issues.push({ path: `${path}.min`, message: "must be an integer" });
          return false;
        }
        if (def.min < 0) {
          issues.push({ path: `${path}.min`, message: "must be non-negative" });
          return false;
        }
      }
      if ("max" in def) {
        if (!isInteger(def.max)) {
          issues.push({ path: `${path}.max`, message: "must be an integer" });
          return false;
        }
        if (def.max < 0) {
          issues.push({ path: `${path}.max`, message: "must be non-negative" });
          return false;
        }
      }
    } else if (kind === "enum") {
      allowedKeys.add("values");
      if (!("values" in def)) {
        issues.push({ path: `${path}.values`, message: "required for enum" });
        return false;
      }
      if (!isValidEnumVocabulary(def.values, path, issues)) {
        return false;
      }
    }
  } else if (arrayKinds.has(kind)) {
    allowedKeys.add("length");
    if (!("length" in def)) {
      issues.push({
        path: `${path}.length`,
        message: "required for array kind",
      });
      return false;
    }
    if (!isPositiveInteger(def.length)) {
      issues.push({
        path: `${path}.length`,
        message: "must be a positive integer",
      });
      return false;
    }
    if (kind === "enum.array") {
      allowedKeys.add("values");
      if (!("values" in def)) {
        issues.push({
          path: `${path}.values`,
          message: "required for enum.array",
        });
        return false;
      }
      if (!isValidEnumVocabulary(def.values, path, issues)) {
        return false;
      }
    }
  }

  for (const key of Object.keys(def)) {
    if (!allowedKeys.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        message: `unknown property on ${kind} def`,
      });
      return false;
    }
  }

  return true;
}

function validateNamespace(
  node: unknown,
  path: string,
  issues: SchemaValidationIssue[],
  allowedKinds: Set<string>,
  scalarKinds: Set<string>,
  arrayKinds: Set<string>,
): boolean {
  if (!isPlainObject(node)) {
    issues.push({ path, message: "namespace must be an object" });
    return false;
  }

  let valid = true;
  for (const [key, value] of Object.entries(node)) {
    const childPath = `${path}.${key}`;
    if (!isPlainObject(value)) {
      issues.push({
        path: childPath,
        message: "namespace entry must be an object",
      });
      valid = false;
      continue;
    }

    if (isString(value.kind)) {
      if (
        !validateLeafDef(
          value,
          childPath,
          issues,
          allowedKinds,
          scalarKinds,
          arrayKinds,
        )
      ) {
        valid = false;
      }
    } else {
      if (
        !validateNamespace(
          value,
          childPath,
          issues,
          allowedKinds,
          scalarKinds,
          arrayKinds,
        )
      ) {
        valid = false;
      }
    }
  }

  return valid;
}

/**
 * Validate an authored spec AST object structurally.
 *
 * @returns `true` if valid, `false` if invalid (collects all issues).
 * @throws SchemaValidationError if the spec is structurally invalid.
 */
export function validateSpecAst(spec: unknown): spec is SpecAstInput {
  const issues: SchemaValidationIssue[] = [];

  if (!isPlainObject(spec)) {
    issues.push({ path: "", message: "spec must be an object" });
    throw new SchemaValidationError(issues);
  }

  const allowedTopKeys = new Set<string>(["$schema", "id", "params", "meters"]);
  for (const key of Object.keys(spec)) {
    if (!allowedTopKeys.has(key)) {
      issues.push({ path: key, message: "unknown top-level property" });
    }
  }

  if (
    "$schema" in spec &&
    spec.$schema !== undefined &&
    (!isString(spec.$schema) || spec.$schema.length === 0)
  ) {
    issues.push({
      path: "$schema",
      message: "must be a non-empty string when present",
    });
  }

  if (
    "id" in spec &&
    spec.id !== undefined &&
    (!isString(spec.id) || spec.id.length === 0)
  ) {
    issues.push({
      path: "id",
      message: "must be a non-empty string when present",
    });
  }

  if ("params" in spec && spec.params !== undefined) {
    if (
      !validateNamespace(
        spec.params,
        "params",
        issues,
        PARAM_KINDS,
        PARAM_SCALAR_KINDS,
        PARAM_ARRAY_KINDS,
      )
    ) {
      // issues already collected
    }
  }

  if ("meters" in spec && spec.meters !== undefined) {
    if (
      !validateNamespace(
        spec.meters,
        "meters",
        issues,
        METER_KINDS,
        METER_SCALAR_KINDS,
        METER_ARRAY_KINDS,
      )
    ) {
      // issues already collected
    }
  }

  if (issues.length > 0) {
    throw new SchemaValidationError(issues);
  }

  return true;
}
