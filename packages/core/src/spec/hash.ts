// File: packages/core/src/spec/hash.ts

import type { MeterDef, ParamDef, SpecHash, SpecInput } from "./types";

// Default ranges for canonicalization
const F32_MAX = 3.4028234663852886e38;
const DEFAULT_F32_RANGE = { min: -F32_MAX, max: F32_MAX };
const DEFAULT_I32_RANGE = { min: -2147483648, max: 2147483647 };
const DEFAULT_U32_RANGE = { min: 0, max: 4294967295 };

/**
 * Canonicalize a ParamDef for stable hashing.
 * CRITICAL: Fill in missing min/max with defaults.
 */
function canonParam(def: ParamDef): ParamDef {
  switch (def.kind) {
    case "f32":
      return {
        kind: "f32",
        min: def.min ?? DEFAULT_F32_RANGE.min,
        max: def.max ?? DEFAULT_F32_RANGE.max,
      };
    case "i32":
      return {
        kind: "i32",
        min: def.min ?? DEFAULT_I32_RANGE.min,
        max: def.max ?? DEFAULT_I32_RANGE.max,
      };
    case "u32":
      return {
        kind: "u32",
        min: def.min ?? DEFAULT_U32_RANGE.min,
        max: def.max ?? DEFAULT_U32_RANGE.max,
      };
    case "enum":
      return { kind: "enum", values: [...def.values] };
    case "enum.array":
      return {
        kind: "enum.array",
        values: [...def.values],
        length: def.length,
      };
    default:
      // Arrays and other types don't need canonicalization
      return def;
  }
}

/**
 * Canonicalize a MeterDef for stable hashing.
 */
function canonMeter(def: MeterDef): MeterDef {
  switch (def.kind) {
    case "enum":
      return { kind: "enum", values: [...def.values] };
    case "enum.array":
      return {
        kind: "enum.array",
        values: [...def.values],
        length: def.length,
      };
    default:
      return def;
  }
}

/**
 * Canonicalize entire spec for stable hashing.
 */
function canonSpec(spec: SpecInput): SpecInput {
  const paramsIn = spec.params ?? {};
  const metersIn = spec.meters ?? {};

  const params: Record<string, ParamDef> = {};
  for (const [k, v] of Object.entries(paramsIn)) {
    params[k] = canonParam(v);
  }

  const meters: Record<string, MeterDef> = {};
  for (const [k, v] of Object.entries(metersIn)) {
    meters[k] = canonMeter(v);
  }

  const result: {
    id: string;
    params?: Record<string, ParamDef>;
    meters?: Record<string, MeterDef>;
  } = { id: spec.id };

  if (Object.keys(params).length > 0) {
    result.params = params;
  }
  if (Object.keys(meters).length > 0) {
    result.meters = meters;
  }

  return result as SpecInput;
}

/**
 * Stable JSON stringification (sorted keys).
 */
function stableStringify(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map(
      (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`,
    );
    return `{${entries.join(",")}}`;
  }

  return "null";
}

/**
 * Simple 64-bit hash mix (no BigInt dependency).
 */
function mix64(
  seedHi: number,
  seedLo: number,
  data: string,
): Readonly<{ hi: number; lo: number }> {
  let h1 = seedHi >>> 0;
  let h2 = seedLo >>> 0;

  for (let i = 0; i < data.length; i += 1) {
    const c = data.charCodeAt(i) >>> 0;
    h1 = Math.imul(h1 ^ c, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ c, 0xc2b2ae35) >>> 0;
    h1 = (h1 ^ (h1 >>> 13)) >>> 0;
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  }

  return { hi: h1 >>> 0, lo: h2 >>> 0 };
}

/**
 * Hash a spec into a stable SpecHash string.
 */
export function hashSpec(spec: SpecInput): SpecHash {
  const canon = canonSpec(spec);
  const json = stableStringify(canon);
  const mixed = mix64(0x12345678, 0x9abcdef0, json);

  const hi = mixed.hi.toString(16).padStart(8, "0");
  const lo = mixed.lo.toString(16).padStart(8, "0");

  // Return as branded SpecHash
  return `${hi}${lo}` as SpecHash;
}
