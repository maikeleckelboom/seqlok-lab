/**
 * @fileoverview
 * Stable $id URI for the spec-ast/v1 JSON Schema.
 *
 * The canonical schema document is published at the package export
 * path `@seqlok/schema/spec-ast/v1.json`. This module only exports
 * the version identifier so consumers can reference it without
 * importing the full schema object.
 */

/** Stable $id of the spec AST v1 JSON Schema. */
export const SPEC_AST_V1_ID =
  "https://seqlok.dev/schema/spec-ast/v1.json" as const;
