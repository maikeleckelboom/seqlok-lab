/**
 * @fileoverview
 * Kind Catalog: Single source of truth for all Seqlok kind → storage mappings.
 *
 * @remarks
 * This file defines the canonical mapping from DSL kinds to:
 * - Storage plane (PF32, PI32, PB, P16, etc.)
 * - TypedArray constructor
 * - Bytes per element
 * - Scalar vs array
 * - Signedness
 *
 * CRITICAL RULE: If a kind exists in the builder surface (defineSpec), then
 * planner + controller + processor + snapshots MUST support it.
 * Adding a kind here forces updates across the entire stack.
 *
 * @see Decision 1: "Kind is the contract. Plane is an implementation detail."
 * @see Decision 2: One canonical "Kind Catalog", zero hand-maintained unions
 */

// Part 1: Extended Plane Universe

/**
 * Extended plane keys including new 8/16-bit planes.
 *
 * @remarks
 * V2 adds:
 * - PU32: 32-bit unsigned param integers
 * - P16: 16-bit param arrays (i16.array, u16.array)
 * - MI32: 32-bit signed meter integers (i32 scalar, i32.array, enum)
 * - M8: 8-bit meter arrays (u8.array, i8.array)
 * - M16: 16-bit meter arrays (i16.array, u16.array)
 */
export type PlaneKeyV2 =
  // Param data planes
  | "PF32" // Float32 params (f32, f32.array)
  | "PI32" // Int32 params (i32, i32.array, enum, enum.array)
  | "PU32" // Uint32 params (u32, u32.array)
  | "PB" // Uint8 params (bool, bool.array, u8.array, i8.array)
  | "P16" // 16-bit params (i16.array, u16.array)
  // Param control
  | "PU" // Param seqlock [LOCK, SEQ]
  // Meter data planes
  | "MF32" // Float32 meters
  | "MF64" // Float64 meters
  | "MU32" // Uint32 meters (u32, bool as 0/1)
  | "MI32" // Int32 meters (i32, enum, enum.array)
  | "M8" // 8-bit meters (u8.array, i8.array)
  | "M16" // 16-bit meters (i16.array, u16.array)
  // Meter control
  | "MU"; // Meter seqlock [LOCK, SEQ]

/**
 * Bytes per element for each plane.
 */
export const BYTES_PER_ELEM_V2: Readonly<Record<PlaneKeyV2, number>> = {
  PF32: 4,
  PI32: 4,
  PU32: 4,
  PB: 1,
  P16: 2,
  PU: 4,
  MF32: 4,
  MF64: 8,
  MU32: 4,
  MI32: 4,
  M8: 1,
  M16: 2,
  MU: 4,
};

/**
 * V2 pack order preserving V1 coarse grouping:
 * Param data → PU → Meter data → MU
 * Within each group: largest alignment first.
 *
 * @remarks
 * This is the SINGLE SOURCE OF TRUTH for plane packing order.
 * All backing mappers MUST use this order.
 */
export const BACKING_PLANE_PACK_ORDER_V2: readonly PlaneKeyV2[] = [
  // Param data planes (4-byte → 2-byte → 1-byte)
  "PF32",
  "PI32",
  "PU32",
  "P16",
  "PB",
  // Param lock
  "PU",
  // Meter data planes (8-byte → 4-byte → 2-byte → 1-byte)
  "MF64",
  "MF32",
  "MU32",
  "MI32",
  "M16",
  "M8",
  // Meter lock
  "MU",
];

/**
 * All planes derived from pack order.
 */
export const ALL_PLANES_V2: readonly PlaneKeyV2[] = BACKING_PLANE_PACK_ORDER_V2;

// Part 2: Kind Definitions

/**
 * All param kinds supported by the DSL.
 */
export type ParamKind =
  // Scalars
  | "f32"
  | "i32"
  | "u32"
  | "bool"
  | "enum"
  // Arrays
  | "f32.array"
  | "i32.array"
  | "u32.array"
  | "u8.array"
  | "i8.array"
  | "i16.array"
  | "u16.array"
  | "bool.array"
  | "enum.array";

/**
 * All meter kinds supported by the DSL.
 */
export type MeterKind =
  // Scalars
  | "f32"
  | "f64"
  | "i32"
  | "u32"
  | "bool"
  | "enum"
  // Arrays
  | "f32.array"
  | "f64.array"
  | "i32.array"
  | "u32.array"
  | "u8.array"
  | "i8.array"
  | "i16.array"
  | "u16.array"
  | "bool.array"
  | "enum.array";

// Part 3: Kind Entry Interfaces

/**
 * TypedArray constructor interface.
 */
type TypedArrayInstance =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array;

interface TypedArrayCtor<T extends TypedArrayInstance> {
  readonly name: string;
  new (length: number): T;
  new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): T;
  readonly BYTES_PER_ELEMENT: number;
}

/**
 * Complete metadata for a param kind.
 */
export interface ParamKindEntry {
  readonly kind: ParamKind;
  readonly plane: PlaneKeyV2;
  readonly bytesPerElement: number;
  readonly isArray: boolean;
  readonly isEnum: boolean;
  readonly isSigned: boolean;
  readonly viewCtor: TypedArrayCtor<TypedArrayInstance>;
  /**
   * For unsigned storage in signed views, decode as unsigned.
   * E.g., u32 stored in Int32Array needs `>>> 0`.
   */
  readonly decodeUnsigned: boolean;
}

/**
 * Complete metadata for a meter kind.
 */
export interface MeterKindEntry {
  readonly kind: MeterKind;
  readonly plane: PlaneKeyV2;
  readonly bytesPerElement: number;
  readonly isArray: boolean;
  readonly isEnum: boolean;
  readonly isSigned: boolean;
  readonly viewCtor: TypedArrayCtor<TypedArrayInstance>;
  readonly decodeUnsigned: boolean;
}

// Part 4: Param Kind Catalog

/**
 * Canonical param kind catalog.
 * EXHAUSTIVE: every ParamKind MUST have an entry.
 */
export const PARAM_KIND_CATALOG: Readonly<Record<ParamKind, ParamKindEntry>> = {
  // === Scalars ===
  f32: {
    kind: "f32",
    plane: "PF32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: false,
    isSigned: true,
    viewCtor: Float32Array,
    decodeUnsigned: false,
  },
  i32: {
    kind: "i32",
    plane: "PI32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: false,
    isSigned: true,
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },
  u32: {
    kind: "u32",
    plane: "PU32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint32Array,
    decodeUnsigned: true,
  },
  bool: {
    kind: "bool",
    plane: "PB",
    bytesPerElement: 1,
    isArray: false,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint8Array,
    decodeUnsigned: false,
  },
  enum: {
    kind: "enum",
    plane: "PI32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: true,
    isSigned: true, // stored as signed index
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },

  // === Arrays ===
  "f32.array": {
    kind: "f32.array",
    plane: "PF32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Float32Array,
    decodeUnsigned: false,
  },
  "i32.array": {
    kind: "i32.array",
    plane: "PI32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },
  "u32.array": {
    kind: "u32.array",
    plane: "PU32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint32Array,
    decodeUnsigned: true,
  },
  "u8.array": {
    kind: "u8.array",
    plane: "PB",
    bytesPerElement: 1,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint8Array,
    decodeUnsigned: false,
  },
  "i8.array": {
    kind: "i8.array",
    plane: "PB",
    bytesPerElement: 1,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Int8Array,
    decodeUnsigned: false,
  },
  "i16.array": {
    kind: "i16.array",
    plane: "P16",
    bytesPerElement: 2,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Int16Array,
    decodeUnsigned: false,
  },
  "u16.array": {
    kind: "u16.array",
    plane: "P16",
    bytesPerElement: 2,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint16Array,
    decodeUnsigned: false,
  },
  "bool.array": {
    kind: "bool.array",
    plane: "PB",
    bytesPerElement: 1,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint8Array,
    decodeUnsigned: false,
  },
  "enum.array": {
    kind: "enum.array",
    plane: "PI32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: true,
    isSigned: true,
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },
};

// Part 5: Meter Kind Catalog

/**
 * Canonical meter kind catalog.
 * EXHAUSTIVE: every MeterKind MUST have an entry.
 */
export const METER_KIND_CATALOG: Readonly<Record<MeterKind, MeterKindEntry>> = {
  // === Scalars ===
  f32: {
    kind: "f32",
    plane: "MF32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: false,
    isSigned: true,
    viewCtor: Float32Array,
    decodeUnsigned: false,
  },
  f64: {
    kind: "f64",
    plane: "MF64",
    bytesPerElement: 8,
    isArray: false,
    isEnum: false,
    isSigned: true,
    viewCtor: Float64Array,
    decodeUnsigned: false,
  },
  i32: {
    kind: "i32",
    plane: "MI32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: false,
    isSigned: true,
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },
  u32: {
    kind: "u32",
    plane: "MU32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint32Array,
    decodeUnsigned: true,
  },
  bool: {
    kind: "bool",
    plane: "MU32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint32Array,
    decodeUnsigned: false,
  },
  enum: {
    kind: "enum",
    plane: "MI32",
    bytesPerElement: 4,
    isArray: false,
    isEnum: true,
    isSigned: true,
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },

  // === Arrays ===
  "f32.array": {
    kind: "f32.array",
    plane: "MF32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Float32Array,
    decodeUnsigned: false,
  },
  "f64.array": {
    kind: "f64.array",
    plane: "MF64",
    bytesPerElement: 8,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Float64Array,
    decodeUnsigned: false,
  },
  "i32.array": {
    kind: "i32.array",
    plane: "MI32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },
  "u32.array": {
    kind: "u32.array",
    plane: "MU32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint32Array,
    decodeUnsigned: true,
  },
  "u8.array": {
    kind: "u8.array",
    plane: "M8",
    bytesPerElement: 1,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint8Array,
    decodeUnsigned: false,
  },
  "i8.array": {
    kind: "i8.array",
    plane: "M8",
    bytesPerElement: 1,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Int8Array,
    decodeUnsigned: false,
  },
  "i16.array": {
    kind: "i16.array",
    plane: "M16",
    bytesPerElement: 2,
    isArray: true,
    isEnum: false,
    isSigned: true,
    viewCtor: Int16Array,
    decodeUnsigned: false,
  },
  "u16.array": {
    kind: "u16.array",
    plane: "M16",
    bytesPerElement: 2,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint16Array,
    decodeUnsigned: false,
  },
  "bool.array": {
    kind: "bool.array",
    plane: "MU32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: false,
    isSigned: false,
    viewCtor: Uint32Array,
    decodeUnsigned: false,
  },
  "enum.array": {
    kind: "enum.array",
    plane: "MI32",
    bytesPerElement: 4,
    isArray: true,
    isEnum: true,
    isSigned: true,
    viewCtor: Int32Array,
    decodeUnsigned: false,
  },
};

// Part 6: Lookup Helpers

/**
 * Get param kind entry. Throws if unknown kind.
 */
export function getParamKindEntry(kind: string): ParamKindEntry {
  const entry = PARAM_KIND_CATALOG[kind as ParamKind];
  // todo: wire real seqlok error.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!entry) {
    throw new Error(`Unknown param kind: ${kind}`);
  }
  return entry;
}

/**
 * Get meter kind entry. Throws if unknown kind.
 */
export function getMeterKindEntry(kind: string): MeterKindEntry {
  const entry = METER_KIND_CATALOG[kind as MeterKind];
  // todo: wire real seqlok error.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!entry) {
    throw new Error(`Unknown meter kind: ${kind}`);
  }
  return entry;
}

/**
 * Check if a kind is a scalar (not an array).
 */
export function isScalarKind(kind: string): boolean {
  return !kind.endsWith(".array");
}

/**
 * Check if a kind is an enum kind.
 */
export function isEnumKind(kind: string): boolean {
  return kind === "enum" || kind === "enum.array";
}

// Part 7: Param Data Plane Helpers

/**
 * Param data planes only (excludes PU control plane).
 */
export type ParamDataPlane = "PF32" | "PI32" | "PU32" | "PB" | "P16";

/**
 * Meter data planes only (excludes MU control plane).
 */
export type MeterDataPlane = "MF32" | "MF64" | "MU32" | "MI32" | "M8" | "M16";

/**
 * Get plane for a param kind.
 */
export function planeOfParamKind(kind: ParamKind): ParamDataPlane {
  return PARAM_KIND_CATALOG[kind].plane as ParamDataPlane;
}

/**
 * Get plane for a meter kind.
 */
export function planeOfMeterKind(kind: MeterKind): MeterDataPlane {
  return METER_KIND_CATALOG[kind].plane as MeterDataPlane;
}

// Part 8: TypedArray Unions (derived from catalog)

/**
 * All typed arrays used for param storage.
 */
export type ParamTypedArray =
  | Float32Array
  | Int32Array
  | Uint32Array
  | Uint8Array
  | Int8Array
  | Int16Array
  | Uint16Array;

/**
 * All typed arrays used for meter storage.
 */
export type MeterTypedArray =
  | Float32Array
  | Float64Array
  | Int32Array
  | Uint32Array
  | Uint8Array
  | Int8Array
  | Int16Array
  | Uint16Array;

// Part 9: Compile-Time Exhaustiveness Assertions

/**
 * Compile-time assertion that all param kinds are covered.
 * If you add a new ParamKind and forget to add it to the catalog,
 * this will cause a compile error.
 */
type AssertParamKindsCovered = {
  [K in ParamKind]: K extends keyof typeof PARAM_KIND_CATALOG ? true : false;
}[ParamKind] extends true
  ? true
  : never;

// This line will fail to compile if any param kind is missing
const _assertParamKindsCovered: AssertParamKindsCovered = true;

/**
 * Compile-time assertion that all meter kinds are covered.
 */
type AssertMeterKindsCovered = {
  [K in MeterKind]: K extends keyof typeof METER_KIND_CATALOG ? true : false;
}[MeterKind] extends true
  ? true
  : never;

const _assertMeterKindsCovered: AssertMeterKindsCovered = true;

// Prevent unused variable warnings
void _assertParamKindsCovered;
void _assertMeterKindsCovered;

// Part 10: PlaneByteLengths V2

/**
 * Extended PlaneByteLengths with new planes.
 */
export interface PlaneByteLengthsV2 {
  // Param planes
  readonly PF32: number;
  readonly PI32: number;
  readonly PU32: number;
  readonly PB: number;
  readonly P16: number;
  readonly PU: number;
  // Meter planes
  readonly MF32: number;
  readonly MF64: number;
  readonly MU32: number;
  readonly MI32: number;
  readonly M8: number;
  readonly M16: number;
  readonly MU: number;
}

/**
 * Create empty plane byte lengths (all zeros).
 * Derived from BACKING_PLANE_PACK_ORDER_V2.
 */
export function createEmptyPlaneByteLengthsV2(): PlaneByteLengthsV2 {
  const result = {} as Record<PlaneKeyV2, number>;
  for (const plane of BACKING_PLANE_PACK_ORDER_V2) {
    result[plane] = 0;
  }
  return result as PlaneByteLengthsV2;
}

// Part 11: Backing View Types V2

/**
 * Param plane views with new planes.
 *
 * @remarks
 * P16 is stored as Uint8Array (raw bytes). To access as typed 16-bit values,
 * use helpers in snapshot-util-v2.ts which create Int16Array/Uint16Array views.
 */
export interface ParamPlaneViewsV2 {
  readonly PF32: Float32Array;
  readonly PI32: Int32Array;
  readonly PU32: Uint32Array;
  readonly PB: Uint8Array;
  readonly P16: Uint8Array; // Raw bytes, interpret via typed subarray
  readonly PU: Uint32Array;
}

/**
 * Meter plane views with new planes.
 *
 * @remarks
 * M16 is stored as Uint8Array (raw bytes). To access as typed 16-bit values,
 * use helpers in snapshot-util-v2.ts which create Int16Array/Uint16Array views.
 */
export interface MeterPlaneViewsV2 {
  readonly MF32: Float32Array;
  readonly MF64: Float64Array;
  readonly MU32: Uint32Array;
  readonly MI32: Int32Array;
  readonly M8: Uint8Array;
  readonly M16: Uint8Array; // Raw bytes, interpret via typed subarray
  readonly MU: Uint32Array;
}
