/**
 * @fileoverview
 * Error codes and detail types for environment capability checks.
 *
 * @remarks
 * - Covers missing SAB/COOP/COEP and other runtime prerequisites.
 * - Used by env guards and diagnostics when probing `globalThis`.
 * - Registered into the global error registry as the `env.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type { ErrorDetails, ErrorMeta } from "../registry";

export type EnvErrorCode = "env.unsupported" | "env.coopCoepRequired";
export type EnvErrorKey = "unsupported" | "coopCoepRequired";

/**
 * Details for `env.unsupported` errors.
 *
 * @remarks
 * - `cause` is attached on the error object itself, not in these details.
 */
export interface EnvUnsupportedDetails extends ErrorDetails {
  readonly feature:
    | "SharedArrayBuffer"
    | "Atomics"
    | "WebAssembly"
    | "WebAssembly.Memory";
  readonly reason?: string;
}

export interface EnvCoopCoepDetails extends ErrorDetails {
  readonly context: "browser" | "worker";
  readonly hasCoopHeader?: boolean;
  readonly hasCoepHeader?: boolean;
}

interface EnvErrorDescriptor<C extends EnvErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface EnvErrorsMap {
  unsupported: EnvErrorDescriptor<"env.unsupported">;
  coopCoepRequired: EnvErrorDescriptor<"env.coopCoepRequired">;
}

const ENV_ERRORS_DEF = {
  unsupported: {
    code: "env.unsupported",
    message: "Required env feature unavailable",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: true,
    },
  },
  coopCoepRequired: {
    code: "env.coopCoepRequired",
    message: "COOP/COEP headers required for SharedArrayBuffer",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const satisfies EnvErrorsMap;

export const ENV_ERRORS: EnvErrorsMap = ENV_ERRORS_DEF;

type EnvCodesFromDescriptors = EnvErrorsMap[EnvErrorKey]["code"];
type EnvCodesEqual = IsExact<EnvErrorCode, EnvCodesFromDescriptors>;

/** @internal */
export type _EnvCodesMatch = AssertTrue<EnvCodesEqual>;
