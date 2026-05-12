/**
 * @fileoverview
 * Public API for @seqlok/schema.
 *
 * Canonical authored spec contract: AST types, canonical contract types,
 * canonicalization, structural validation, and JSON Schema version identifier.
 */

// AST types
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
} from "./ast";

// Canonical contract types
export type { CanonicalSpec, CanonicalSpecFromAst } from "./canonical";

// Canonicalization
export { canonicalizeSpecAst } from "./canonicalize";

// Schema error domain
export { SCHEMA, SCHEMA_ERRORS, createSchemaError } from "./errors/schema";
export type {
  SchemaErrorCode,
  SchemaErrorKey,
  SchemaError,
  SchemaErrorFactory,
  SchemaInvalidDefinitionDetails,
  SchemaInvalidSegmentDetails,
  SchemaDuplicateCanonicalKeyDetails,
  SchemaLeafNamespaceConflictDetails,
  SchemaRangeInvalidDetails,
} from "./errors/schema";

// Validation
export {
  validateSpecAst,
  SchemaValidationError,
  type SchemaValidationIssue,
} from "./validate";

// JSON Schema identifier
export { SPEC_AST_V1_ID } from "./schema-id";
