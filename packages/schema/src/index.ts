/**
 * @fileoverview
 * Public API for @seqlok/schema.
 *
 * Canonical authored spec contract: types, structural validation,
 * normalization, and JSON Schema version identifier.
 */

// Types
export type {
  SpecNamespace,
  ScalarRange,
  F32ParamDef,
  I32ParamDef,
  U32ParamDef,
  BoolParamDef,
  EnumParamDef,
  F32ArrayParamDef,
  I32ArrayParamDef,
  U32ArrayParamDef,
  U8ArrayParamDef,
  I8ArrayParamDef,
  I16ArrayParamDef,
  U16ArrayParamDef,
  BoolArrayParamDef,
  EnumArrayParamDef,
  ParamDef,
  F32MeterDef,
  F64MeterDef,
  I32MeterDef,
  U32MeterDef,
  BoolMeterDef,
  EnumMeterDef,
  F32ArrayMeterDef,
  F64ArrayMeterDef,
  U32ArrayMeterDef,
  I32ArrayMeterDef,
  U8ArrayMeterDef,
  I8ArrayMeterDef,
  I16ArrayMeterDef,
  U16ArrayMeterDef,
  BoolArrayMeterDef,
  EnumArrayMeterDef,
  MeterDef,
  ScalarParamDef,
  ScalarMeterDef,
  SpecAstInput,
} from "./types";

// Validation
export {
  validateSpecAst,
  SchemaValidationError,
  type SchemaValidationIssue,
} from "./validate";

// Normalization
export { normalizeSpecAst } from "./normalize";

// JSON Schema identifier
export { SPEC_AST_V1_ID } from "./schema-id";
