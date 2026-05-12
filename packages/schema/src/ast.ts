/**
 * @fileoverview
 * Authored AST types for Seqlok.
 *
 * These types represent the JSON-serializable authored contract surface.
 * They are owned by @seqlok/schema and consumed by @seqlok/core for
 * semantic compilation into runtime contracts.
 */

/**
 * Recursive namespace for author-time specs.
 * Must be interface (not type alias) to avoid TS2456 circular errors.
 */
export interface SpecNamespace<T> {
  readonly [key: string]: T | SpecNamespace<T>;
}

/**
 * Author-time numeric range (optional min/max for ergonomics).
 */
export interface ScalarRange {
  readonly min?: number;
  readonly max?: number;
}

export type F32ParamDef = Readonly<{ kind: "f32" } & ScalarRange>;
export type I32ParamDef = Readonly<{ kind: "i32" } & ScalarRange>;
export type U32ParamDef = Readonly<{ kind: "u32" } & ScalarRange>;

export type BoolParamDef = Readonly<{ kind: "bool" }>;
export type EnumParamDef<Values extends readonly string[] = readonly string[]> =
  Readonly<{ kind: "enum"; values: Values }>;

export type F32ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "f32.array";
  length: Len;
}>;
export type I32ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "i32.array";
  length: Len;
}>;
export type U32ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "u32.array";
  length: Len;
}>;

export type U8ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "u8.array";
  length: Len;
}>;
export type I8ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "i8.array";
  length: Len;
}>;
export type I16ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "i16.array";
  length: Len;
}>;
export type U16ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "u16.array";
  length: Len;
}>;

export type BoolArrayParamDef<Len extends number = number> = Readonly<{
  kind: "bool.array";
  length: Len;
}>;
export type EnumArrayParamDef<
  Values extends readonly string[] = readonly string[],
  Len extends number = number,
> = Readonly<{
  kind: "enum.array";
  values: Values;
  length: Len;
}>;

export type ParamDef =
  | F32ParamDef
  | I32ParamDef
  | U32ParamDef
  | BoolParamDef
  | EnumParamDef
  | F32ArrayParamDef
  | I32ArrayParamDef
  | U32ArrayParamDef
  | U8ArrayParamDef
  | I8ArrayParamDef
  | I16ArrayParamDef
  | U16ArrayParamDef
  | BoolArrayParamDef
  | EnumArrayParamDef;

export type F32MeterDef = Readonly<{ kind: "f32" }>;
export type F64MeterDef = Readonly<{ kind: "f64" }>;
export type I32MeterDef = Readonly<{ kind: "i32" }>;
export type U32MeterDef = Readonly<{ kind: "u32" }>;
export type BoolMeterDef = Readonly<{ kind: "bool" }>;
export type EnumMeterDef<Values extends readonly string[] = readonly string[]> =
  Readonly<{ kind: "enum"; values: Values }>;

export type F32ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "f32.array";
  length: Len;
}>;
export type F64ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "f64.array";
  length: Len;
}>;
export type U32ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "u32.array";
  length: Len;
}>;
export type I32ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "i32.array";
  length: Len;
}>;

export type U8ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "u8.array";
  length: Len;
}>;
export type I8ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "i8.array";
  length: Len;
}>;
export type I16ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "i16.array";
  length: Len;
}>;
export type U16ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "u16.array";
  length: Len;
}>;

export type BoolArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "bool.array";
  length: Len;
}>;
export type EnumArrayMeterDef<
  Values extends readonly string[] = readonly string[],
  Len extends number = number,
> = Readonly<{
  kind: "enum.array";
  values: Values;
  length: Len;
}>;

export type MeterDef =
  | F32MeterDef
  | F64MeterDef
  | I32MeterDef
  | U32MeterDef
  | BoolMeterDef
  | EnumMeterDef
  | F32ArrayMeterDef
  | F64ArrayMeterDef
  | U32ArrayMeterDef
  | I32ArrayMeterDef
  | U8ArrayMeterDef
  | I8ArrayMeterDef
  | I16ArrayMeterDef
  | U16ArrayMeterDef
  | BoolArrayMeterDef
  | EnumArrayMeterDef;

export type ScalarParamDef = Exclude<ParamDef, { kind: `${string}.array` }>;
export type ScalarMeterDef = Exclude<MeterDef, { kind: `${string}.array` }>;

/**
 * Author-time spec (AST form).
 * - $schema is OPTIONAL for editor/tooling self-reference
 * - id is OPTIONAL for authoring (will be auto-generated during semantic compilation)
 * - Nested namespaces allowed
 */
export type SpecAstInput = Readonly<{
  readonly $schema?: string;
  readonly id?: string;
  readonly params?: SpecNamespace<ParamDef>;
  readonly meters?: SpecNamespace<MeterDef>;
}>;
