/**
 * @fileoverview
 * Read-only view over domain registries from base/core/primitives/introspect.
 *
 * This module normalizes all per-domain registries to a common
 * `RegistryEntry` shape so that higher-level tooling (JSON export,
 * native codegen, REPL helpers) can treat them uniformly.
 */

import {
  type ErrorDescriptor as BaseErrorDescriptor,
  INTERNAL_ERRORS,
  panic,
} from "@seqlok/base";
import { COMMANDS_ERRORS } from "@seqlok/commands";
import {
  BACKING_ERRORS,
  BINDING_ERRORS,
  ENV_ERRORS,
  HANDOFF_ERRORS,
  PLAN_ERRORS,
  SPEC_ERRORS,
} from "@seqlok/core";
import { HOTSWAP_ERRORS } from "@seqlok/hotswap";
import { PRIMITIVES_ERRORS } from "@seqlok/primitives";

import { INTROSPECT_ERRORS } from "./introspect";

import type { DomainName } from "./all-domains";

/**
 * Descriptor for a single error.
 *
 * Matches the public registry entry shape in `@seqlok/base`.
 */
export type RegistryEntry = BaseErrorDescriptor;

// Concrete registry types per domain, inferred from the actual exports.
// No need to import internal `*ErrorMap` types.
type InternalRegistry = typeof INTERNAL_ERRORS;
type EnvRegistry = typeof ENV_ERRORS;
type BackingRegistry = typeof BACKING_ERRORS;
type PrimitivesRegistry = typeof PRIMITIVES_ERRORS;
type BindingRegistry = typeof BINDING_ERRORS;
type SpecRegistry = typeof SPEC_ERRORS;
type PlanRegistry = typeof PLAN_ERRORS;
type HandoffRegistry = typeof HANDOFF_ERRORS;
type CommandsRegistry = typeof COMMANDS_ERRORS;
type IntrospectRegistry = typeof INTROSPECT_ERRORS;
type HotswapRegistry = typeof HOTSWAP_ERRORS;

/**
 * Registry map for a single domain.
 *
 * Each concrete registry is a mapping from a local error key
 * (e.g. `"allocFailed"`) to a {@link RegistryEntry}.
 *
 * This union is enough for introspection tooling: all variants share
 * the same value shape.
 */
export type DomainRegistry =
  | InternalRegistry
  | EnvRegistry
  | BackingRegistry
  | PrimitivesRegistry
  | BindingRegistry
  | SpecRegistry
  | PlanRegistry
  | HandoffRegistry
  | CommandsRegistry
  | IntrospectRegistry
  | HotswapRegistry;

/**
 * Safely access a registry entry by key.
 *
 * @remarks
 * `DomainRegistry` is a union of concrete registry types, each with
 * specific known keys. When iterating with `Object.keys()`, TypeScript
 * widens the key type to `string`, which cannot index the union.
 *
 * This helper encapsulates the necessary assertion, centralizing it
 * rather than scattering `as keyof ...` casts across call sites.
 *
 * @param registry - The domain registry to access.
 * @param key - The error key to look up.
 * @returns The registry entry, or `undefined` if not found.
 */
export function getRegistryEntry(
  registry: DomainRegistry,
  key: string,
): RegistryEntry | undefined {
  return (registry as Record<string, RegistryEntry>)[key];
}

/**
 * Look up the registry for a given domain prefix.
 *
 * All registries share a common value shape:
 *
 *   { [localKey: string]: { code, message, numericCode, meta } }
 *
 * The return type is a union of concrete registry types; higher-level
 * code can treat it structurally (e.g., via `Object.entries`).
 */
export function getRegistryForDomain(domain: DomainName): DomainRegistry {
  switch (domain) {
    case "internal":
      return INTERNAL_ERRORS;

    case "env":
      return ENV_ERRORS;

    case "backing":
      return BACKING_ERRORS;

    case "primitives":
      return PRIMITIVES_ERRORS;

    case "binding":
      return BINDING_ERRORS;

    case "spec":
      return SPEC_ERRORS;

    case "plan":
      return PLAN_ERRORS;

    case "handoff":
      return HANDOFF_ERRORS;

    case "commands":
      return COMMANDS_ERRORS;

    case "introspect":
      return INTROSPECT_ERRORS;

    case "hotswap":
      return HOTSWAP_ERRORS;

    default:
      // DomainName is currently just `string`, so this is a runtime guard,
      // not an exhaustiveness check.
      panic(`Unhandled error domain in registry lookup: ${domain}`);
  }
}
