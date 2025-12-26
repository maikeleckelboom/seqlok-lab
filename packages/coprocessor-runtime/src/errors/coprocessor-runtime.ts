/**
 * @fileoverview
 * Error codes, detail types, and factory for the `coprocessorRuntime.*` domains.
 *
 * @remarks
 * This domains covers:
 * - Host-side mounting (fetching wrapper/wasm and basic validation)
 * - Worklet-side mount lifecycle (busy / invalid messages / invalid bytes)
 * - Factory resolution (bundled registry-first vs dynamic wrapper backend)
 * - Runtime invariants (RT allocation forbidden, faulted processor)
 *
 * Numeric codes are assigned by @seqlok/introspect via stable key order.
 */

import {
  type AssertTrue,
  defineErrorDomain,
  type DomainDef,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorDomainWithFactory,
  type ErrorKeyFromCode,
  type ErrorKeyOf,
  type IsExact,
  type KeyedErrorFactoryOf,
} from "@seqlok/base";

export type CoprocessorRuntimePhase = "loading" | "rt";

/**
 * JSON-serializable value type for error details which must cross `postMessage`.
 *
 * @remarks
 * This is deliberately strict: no `undefined`, no functions, no class instances.
 *
 * TypeScript forbids recursive type-aliases under some configurations, so the
 * recursive pieces are expressed as interfaces.
 */
export type CoprocessorRuntimeJsonPrimitive = string | number | boolean | null;

export interface CoprocessorRuntimeJsonObject {
  readonly [key: string]: CoprocessorRuntimeJsonValue;
}

export type CoprocessorRuntimeJsonArray =
  readonly CoprocessorRuntimeJsonValue[];

export type CoprocessorRuntimeJsonValue =
  | CoprocessorRuntimeJsonPrimitive
  | CoprocessorRuntimeJsonObject
  | CoprocessorRuntimeJsonArray;

/**
 * Coprocessor runtime error codes.
 *
 * @remarks
 * These codes are stable and safe to persist in logs and diagnostics.
 */
export type CoprocessorRuntimeErrorCode = ErrorCodeOf<CoprocessorRuntimeDomain>;

/**
 * Symbolic keys for coprocessor runtime error descriptors.
 *
 * @remarks
 * Derived from fully-qualified codes by dropping the `coprocessorRuntime.` prefix.
 */
export type CoprocessorRuntimeErrorKey =
  ErrorKeyFromCode<CoprocessorRuntimeErrorCode>;

/**
 * Details for `coprocessorRuntime.busyLoading`.
 *
 * @remarks
 * A mount request arrived while a prior mount is still in flight.
 */
export interface CoprocessorRuntimeBusyLoadingDetails extends ErrorDetails {
  readonly requestedKey: string;
  readonly requestedSeq: number;
  readonly currentKey?: string;
  readonly currentSeq?: number;
}

/**
 * Details for `coprocessorRuntime.invalidMountMessage`.
 *
 * @remarks
 * The worklet received a message that is not a valid `cp:*` mount message.
 */
export interface CoprocessorRuntimeInvalidMountMessageDetails
  extends ErrorDetails {
  readonly reason: string;
  readonly receivedType?: string;
  readonly receivedKeys?: readonly string[];
}

/**
 * Details for `coprocessorRuntime.emptyKey`.
 */
export interface CoprocessorRuntimeEmptyKeyDetails extends ErrorDetails {
  /**
   * Operation context.
   *
   * @example "mountCoprocessor", "toMountMessage"
   */
  readonly op: string;
}

/**
 * Details for `coprocessorRuntime.invalidWasmBytes`.
 */
export interface CoprocessorRuntimeInvalidWasmBytesDetails
  extends ErrorDetails {
  readonly op: string;
  readonly receivedKind: string;
  readonly byteLength?: number;
}

/**
 * Details for `coprocessorRuntime.fetchFailed`.
 *
 * @remarks
 * Host-side: wrapper/wasm fetch failed with a non-OK status.
 */
export interface CoprocessorRuntimeFetchFailedDetails extends ErrorDetails {
  readonly resource: "wrapper" | "wasm";
  readonly url: string;
  readonly status: number;
}

/**
 * Details for `coprocessorRuntime.wrapperReturnedHtml`.
 *
 * @remarks
 * Host-side: wrapperUrl returned HTML (often a dev server 404 page).
 */
export interface CoprocessorRuntimeWrapperReturnedHtmlDetails
  extends ErrorDetails {
  readonly url: string;
}

/**
 * Details for `coprocessorRuntime.bundledFactoryNotFound`.
 *
 * @remarks
 * Worklet-side: registry-first path could not find a bundled factory for `key`.
 */
export interface CoprocessorRuntimeBundledFactoryNotFoundDetails
  extends ErrorDetails {
  readonly key: string;
  readonly registeredKeys: readonly string[];
}

/**
 * Details for `coprocessorRuntime.dynamicWrapperEvalFailed`.
 */
export interface CoprocessorRuntimeDynamicWrapperEvalFailedDetails
  extends ErrorDetails {
  readonly key: string;
  readonly seq: number;
  readonly stage: "compile" | "execute" | "resolveFactory";
  readonly errorMessage: string;
}

/**
 * Details for `coprocessorRuntime.dynamicWrapperNoFactory`.
 */
export interface CoprocessorRuntimeDynamicWrapperNoFactoryDetails
  extends ErrorDetails {
  readonly key: string;
  readonly seq: number;
  readonly reason: string;
}

/**
 * Details for `coprocessorRuntime.workletError`.
 *
 * @remarks
 * Host-side: the worklet responded with `cp:error`.
 */
export interface CoprocessorRuntimeWorkletErrorDetails extends ErrorDetails {
  readonly key: string;
  readonly seq: number;

  /**
   * Phase observed in the worklet when the error occurred.
   */
  readonly phase: CoprocessorRuntimePhase;

  /**
   * Human-friendly error message forwarded from the worklet.
   */
  readonly message: string;

  /**
   * Optional domains error code forwarded from the worklet.
   */
  readonly workletCode?: CoprocessorRuntimeErrorCode;

  /**
   * Optional structured, JSON-serializable details forwarded from the worklet.
   */
  readonly workletDetails?: CoprocessorRuntimeJsonObject;
}

/**
 * Details for `coprocessorRuntime.runtimeFaulted`.
 *
 * @remarks
 * Worklet-side: the processor has faulted and will no longer run normally.
 */
export interface CoprocessorRuntimeRuntimeFaultedDetails extends ErrorDetails {
  readonly key: string;
  readonly seq: number;
  readonly phase: "loading" | "rt";
  readonly errorMessage: string;
}

/**
 * Details for `coprocessorRuntime.rtAllocationForbidden`.
 *
 * @remarks
 * Worklet-side invariant: allocating/freeing memory on the realtime path is forbidden.
 */
export interface CoprocessorRuntimeRtAllocationForbiddenDetails
  extends ErrorDetails {
  readonly op: "malloc" | "free";
  readonly phase: "loading" | "rt";
  readonly key?: string;
}

/**
 * Details for `coprocessorRuntime.moduleNotAvailable`.
 */
export interface CoprocessorRuntimeModuleNotAvailableDetails
  extends ErrorDetails {
  readonly op: "malloc" | "free" | "process";
}

/**
 * Details for `coprocessorRuntime.moduleNotReady`.
 */
export interface CoprocessorRuntimeModuleNotReadyDetails extends ErrorDetails {
  readonly op: "malloc" | "free" | "process";
  readonly state: "idle" | "loading" | "ready" | "faulted";
}

/**
 * Domain-local defs object used with `defineErrorDomain`.
 *
 * @remarks
 * This is the single source of truth for message + meta; fully-qualified
 * codes are derived as `${prefix}.${key}` by the helper.
 */
interface CoprocessorRuntimeDomainDefs {
  readonly busyLoading: DomainDef;
  readonly invalidMountMessage: DomainDef;
  readonly emptyKey: DomainDef;
  readonly invalidWasmBytes: DomainDef;
  readonly fetchFailed: DomainDef;
  readonly wrapperReturnedHtml: DomainDef;
  readonly bundledFactoryNotFound: DomainDef;
  readonly dynamicWrapperEvalFailed: DomainDef;
  readonly dynamicWrapperNoFactory: DomainDef;
  readonly workletError: DomainDef;
  readonly runtimeFaulted: DomainDef;
  readonly rtAllocationForbidden: DomainDef;
  readonly moduleNotAvailable: DomainDef;
  readonly moduleNotReady: DomainDef;
}

const COPROCESSOR_RUNTIME_DEFS: CoprocessorRuntimeDomainDefs = {
  busyLoading: {
    message: "Coprocessor runtime is busy: already loading",
    meta: { severity: "warning", recoverable: true, boundarySafe: true },
  },
  invalidMountMessage: {
    message: "Invalid coprocessor mount message",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  emptyKey: {
    message: "Coprocessor key is empty",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  invalidWasmBytes: {
    message: "Invalid wasm bytes",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  fetchFailed: {
    message: "Failed to fetch coprocessor resource",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  wrapperReturnedHtml: {
    message: "Wrapper URL returned HTML (check path)",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  bundledFactoryNotFound: {
    message: "Bundled factory not found for key",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  dynamicWrapperEvalFailed: {
    message: "Dynamic wrapper evaluation failed",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  dynamicWrapperNoFactory: {
    message: "Dynamic wrapper did not yield a factory",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  workletError: {
    message: "Worklet returned an error",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  runtimeFaulted: {
    message: "Coprocessor runtime faulted",
    meta: { severity: "fatal", recoverable: false, boundarySafe: false },
  },
  rtAllocationForbidden: {
    message: "RT allocation forbidden",
    meta: { severity: "fatal", recoverable: false, boundarySafe: false },
  },
  moduleNotAvailable: {
    message: "Module not available",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
  moduleNotReady: {
    message: "Module not ready",
    meta: { severity: "error", recoverable: true, boundarySafe: true },
  },
};

/**
 * Logical coprocessor runtime domains, including registry and factory.
 */
export const COPROCESSOR_RUNTIME_DOMAIN: ErrorDomainWithFactory<
  "coprocessorRuntime",
  CoprocessorRuntimeDomainDefs
> = defineErrorDomain("coprocessorRuntime", COPROCESSOR_RUNTIME_DEFS);

/**
 * Convenience alias for the domains type.
 */
export type CoprocessorRuntimeDomain = typeof COPROCESSOR_RUNTIME_DOMAIN;

/**
 * Registry type for the coprocessor runtime domains.
 */
export type CoprocessorRuntimeErrorsMap = DomainRegistry<
  "coprocessorRuntime",
  CoprocessorRuntimeDomainDefs
>;

/**
 * Exported descriptor map with an explicit type for isolatedDeclarations.
 */
export const COPROCESSOR_RUNTIME_ERRORS: CoprocessorRuntimeErrorsMap =
  COPROCESSOR_RUNTIME_DOMAIN.registry;

/**
 * Expected fully-qualified code union.
 *
 * @remarks
 * This is a sanity check. Update additively when adding new keys.
 */
type ExpectedCoprocessorRuntimeErrorCode =
  | "coprocessorRuntime.busyLoading"
  | "coprocessorRuntime.invalidMountMessage"
  | "coprocessorRuntime.emptyKey"
  | "coprocessorRuntime.invalidWasmBytes"
  | "coprocessorRuntime.fetchFailed"
  | "coprocessorRuntime.wrapperReturnedHtml"
  | "coprocessorRuntime.bundledFactoryNotFound"
  | "coprocessorRuntime.dynamicWrapperEvalFailed"
  | "coprocessorRuntime.dynamicWrapperNoFactory"
  | "coprocessorRuntime.workletError"
  | "coprocessorRuntime.runtimeFaulted"
  | "coprocessorRuntime.rtAllocationForbidden"
  | "coprocessorRuntime.moduleNotAvailable"
  | "coprocessorRuntime.moduleNotReady";

/** @internal */
export type _CoprocessorRuntimeCodesMatch = AssertTrue<
  IsExact<CoprocessorRuntimeErrorCode, ExpectedCoprocessorRuntimeErrorCode>
>;

/**
 * Per-key details mapping for coprocessor runtime errors.
 */
export interface CoprocessorRuntimeErrorDetailsByKey {
  readonly busyLoading: CoprocessorRuntimeBusyLoadingDetails;
  readonly invalidMountMessage: CoprocessorRuntimeInvalidMountMessageDetails;
  readonly emptyKey: CoprocessorRuntimeEmptyKeyDetails;
  readonly invalidWasmBytes: CoprocessorRuntimeInvalidWasmBytesDetails;
  readonly fetchFailed: CoprocessorRuntimeFetchFailedDetails;
  readonly wrapperReturnedHtml: CoprocessorRuntimeWrapperReturnedHtmlDetails;
  readonly bundledFactoryNotFound: CoprocessorRuntimeBundledFactoryNotFoundDetails;
  readonly dynamicWrapperEvalFailed: CoprocessorRuntimeDynamicWrapperEvalFailedDetails;
  readonly dynamicWrapperNoFactory: CoprocessorRuntimeDynamicWrapperNoFactoryDetails;
  readonly workletError: CoprocessorRuntimeWorkletErrorDetails;
  readonly runtimeFaulted: CoprocessorRuntimeRuntimeFaultedDetails;
  readonly rtAllocationForbidden: CoprocessorRuntimeRtAllocationForbiddenDetails;
  readonly moduleNotAvailable: CoprocessorRuntimeModuleNotAvailableDetails;
  readonly moduleNotReady: CoprocessorRuntimeModuleNotReadyDetails;
}

export function isCoprocessorRuntimePhase(
  v: unknown,
): v is CoprocessorRuntimePhase {
  return v === "loading" || v === "rt";
}

export function isCoprocessorRuntimeErrorCode(
  v: unknown,
): v is CoprocessorRuntimeErrorCode {
  if (typeof v !== "string") {
    return false;
  }

  const prefix = "coprocessorRuntime.";
  if (!v.startsWith(prefix)) {
    return false;
  }

  const localKey = v.slice(prefix.length);

  return Object.prototype.hasOwnProperty.call(
    COPROCESSOR_RUNTIME_ERRORS,
    localKey,
  );
}

/**
 * Compile-time check: detail mapping keys match the domains's local keys.
 * @internal
 */
export type _CoprocessorRuntimeDetailKeysMatch = AssertTrue<
  IsExact<
    keyof CoprocessorRuntimeErrorDetailsByKey,
    ErrorKeyOf<CoprocessorRuntimeDomain>
  >
>;

/**
 * Domain-local factory type for disclosed `coprocessorRuntime.*` errors.
 */
export type CoprocessorRuntimeErrorFactory = KeyedErrorFactoryOf<
  CoprocessorRuntimeDomain,
  CoprocessorRuntimeErrorDetailsByKey
>;

/**
 * Domain-local factory for creating `coprocessorRuntime.*` errors.
 */
export const createCoprocessorRuntimeError: CoprocessorRuntimeErrorFactory = (
  key,
  details,
  cause,
) => COPROCESSOR_RUNTIME_DOMAIN.createError(key, details, cause);

/**
 * Sanity check: explicit `CoprocessorRuntimeErrorKey` matches the domains keys.
 */
type DomainKeys = ErrorKeyOf<CoprocessorRuntimeDomain>;
type KeysEqual = IsExact<CoprocessorRuntimeErrorKey, DomainKeys>;
/** @internal */
export type _CoprocessorRuntimeKeysMatch = AssertTrue<KeysEqual>;
