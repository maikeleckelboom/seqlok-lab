/**
 * @fileoverview
 * Error-domain definitions for @seqlok/integration.
 *
 * Integration wiring and host-level registration failures are routed through
 * the `integration.*` domain.
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

export interface IntegrationDuplicatePluginDetails extends ErrorDetails {
  readonly pluginId: string;
}

interface IntegrationDetailsByKey {
  readonly duplicatePlugin: IntegrationDuplicatePluginDetails;
}

const INTEGRATION_DEFS = {
  duplicatePlugin: {
    message: "Plugin with this id is already registered",
    meta: { severity: "error", recoverable: false, boundarySafe: true },
  },
} as const;

type IntegrationDefs = typeof INTEGRATION_DEFS;

export const INTEGRATION: BuiltErrorDomain<
  "integration",
  IntegrationDefs
> = buildErrorDomain("integration", DOMAIN_IDS.integration, INTEGRATION_DEFS);

export type IntegrationErrorCode = ErrorCodeOf<typeof INTEGRATION>;
export type IntegrationErrorKey = ErrorKeyOf<typeof INTEGRATION>;
export type IntegrationError = SeqlokError<IntegrationErrorCode>;

export const INTEGRATION_ERRORS: DomainRegistry<
  "integration",
  IntegrationDefs
> = INTEGRATION.registry;

export const createIntegrationError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"integration", IntegrationDefs>,
  IntegrationDetailsByKey
> = INTEGRATION.createError;

export type IntegrationErrorFactory = typeof createIntegrationError;