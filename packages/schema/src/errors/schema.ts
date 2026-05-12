/**
 * @fileoverview
 * Error-domain definitions for @seqlok/schema.
 *
 * Canonical compilation and structural validation failures are routed through
 * the `schema.*` domain. These codes replace the previous borrowing of
 * core-owned `spec.*` codes for schema-owned failures.
 */

import {
  buildErrorDomain,
  type BuiltErrorDomain,
  DOMAIN_IDS,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";

/**
 * Detail payload for invalid authored definitions.
 *
 * Used when a namespace child has an invalid kind or a required field is
 * missing during canonical compilation.
 */
export interface SchemaInvalidDefinitionDetails extends ErrorDetails {
  readonly key?: string;
  readonly reason?:
    | "invalidKind"
    | "missingMinMax";
}

/**
 * Detail payload for invalid authored namespace segments.
 */
export interface SchemaInvalidSegmentDetails extends ErrorDetails {
  readonly plane: string;
  readonly parentPath: readonly string[];
  readonly offendingSegment: string;
  readonly reason: "empty-segment" | "segment-contains-dot";
}

/**
 * Detail payload for duplicate canonical keys discovered during
 * canonical collapse.
 */
export interface SchemaDuplicateCanonicalKeyDetails extends ErrorDetails {
  readonly plane: string;
  readonly canonicalKey: string;
  readonly firstPath: readonly string[];
  readonly secondPath: readonly string[];
}

/**
 * Detail payload for leaf-versus-namespace collisions discovered during
 * canonical collapse.
 */
export interface SchemaLeafNamespaceConflictDetails extends ErrorDetails {
  readonly plane: string;
  readonly canonicalPath: string;
  readonly leafPath: readonly string[];
  readonly namespacePath: readonly string[];
  readonly conflictKind:
    | "namespace-collides-with-leaf"
    | "leaf-collides-with-namespace"
    | "ancestor-leaf-blocks-descendant";
}

/**
 * Detail payload for invalid scalar ranges.
 */
export interface SchemaRangeInvalidDetails extends ErrorDetails {
  readonly key: string;
  readonly min?: number;
  readonly max?: number;
}

interface SchemaDetailsByKey {
  readonly invalidDefinition: SchemaInvalidDefinitionDetails;
  readonly invalidSegment: SchemaInvalidSegmentDetails;
  readonly duplicateCanonicalKey: SchemaDuplicateCanonicalKeyDetails;
  readonly leafNamespaceConflict: SchemaLeafNamespaceConflictDetails;
  readonly rangeInvalid: SchemaRangeInvalidDetails;
}

const SCHEMA_DEFS = {
  invalidDefinition: {
    message: "Schema definition invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  invalidSegment: {
    message: "Authored namespace segment invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  duplicateCanonicalKey: {
    message: "Canonical key duplicated during spec canonicalization",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  leafNamespaceConflict: {
    message: "Leaf and namespace collide during spec canonicalization",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  rangeInvalid: {
    message: "Parameter range invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

type SchemaDefs = typeof SCHEMA_DEFS;

export const SCHEMA: BuiltErrorDomain<"schema", SchemaDefs> = buildErrorDomain(
  "schema",
  DOMAIN_IDS.schema,
  SCHEMA_DEFS,
);

export type SchemaErrorCode = ErrorCodeOf<typeof SCHEMA>;
export type SchemaErrorKey = ErrorKeyOf<typeof SCHEMA>;
export type SchemaError = SeqlokError<SchemaErrorCode>;

export const SCHEMA_ERRORS: DomainRegistry<"schema", SchemaDefs> =
  SCHEMA.registry;

export const createSchemaError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"schema", SchemaDefs>,
  SchemaDetailsByKey
> = SCHEMA.createError;

export type SchemaErrorFactory = typeof createSchemaError;