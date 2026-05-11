/**
 * @fileoverview
 * Deterministic normalization of authored spec AST objects into canonical form.
 *
 * This operates at the authored-contract layer only:
 * - sorts object keys deterministically
 * - preserves array order (enum vocabulary order is identity-significant)
 * - omits empty params/meters planes
 * - does NOT flatten namespaces
 * - does NOT apply runtime defaults
 * - does NOT validate semantic meaning
 */

import { validateSpecAst } from "./validate";

import type { MeterDef, ParamDef, SpecAstInput, SpecNamespace } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLeafDef(value: Record<string, unknown>): value is { kind: string } {
  return typeof value.kind === "string";
}

function normalizeLeafDef<T extends ParamDef | MeterDef>(def: T): T {
  const base: Record<string, unknown> = { kind: def.kind };

  if ("length" in def) {
    base.length = def.length;
  }
  if ("values" in def) {
    base.values = [...def.values];
  }
  if ("min" in def) {
    base.min = def.min;
  }
  if ("max" in def) {
    base.max = def.max;
  }

  return base as T;
}

function normalizeNamespace<T extends ParamDef | MeterDef>(
  ns: SpecNamespace<T>,
): SpecNamespace<T> {
  const sorted: Record<string, T | SpecNamespace<T>> = {};

  for (const key of Object.keys(ns).sort()) {
    const value = ns[key];
    if (isPlainObject(value) && isLeafDef(value)) {
      sorted[key] = normalizeLeafDef(value);
    } else if (isPlainObject(value)) {
      sorted[key] = normalizeNamespace(value as unknown as SpecNamespace<T>);
    }
  }

  return sorted as SpecNamespace<T>;
}

/**
 * Normalize an authored spec AST into its canonical authored form.
 *
 * - Object keys are sorted at every level.
 * - Array values (enum vocabularies) preserve authored order.
 * - Empty params and meters are omitted.
 * - Namespace nesting is preserved.
 * - Input must be structurally valid.
 */
export function normalizeSpecAst(input: SpecAstInput): SpecAstInput {
  validateSpecAst(input);

  const result: {
    $schema?: string;
    id?: string;
    params?: SpecNamespace<ParamDef>;
    meters?: SpecNamespace<MeterDef>;
  } = {};

  if (input.$schema !== undefined) {
    result.$schema = input.$schema;
  }

  if (input.id !== undefined && input.id.length > 0) {
    result.id = input.id;
  }

  if (input.params !== undefined && Object.keys(input.params).length > 0) {
    result.params = normalizeNamespace(input.params);
  }

  if (input.meters !== undefined && Object.keys(input.meters).length > 0) {
    result.meters = normalizeNamespace(input.meters);
  }

  return result as SpecAstInput;
}
