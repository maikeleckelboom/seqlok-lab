/**
 * @fileoverview
 * Error codes and detail types for handoff artifacts.
 *
 * @remarks
 * - Covers invalid/mismatched plan/backing/spec combinations in handoffs.
 * - Used when validating handoff payloads at controller/processor boundaries.
 * - Registered into the global error registry as the `handoff.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type { ErrorDetails, ErrorMeta } from "../registry";

export type HandoffErrorCode =
  | "handoff.versionMismatch"
  | "handoff.invalidArtifact"
  | "handoff.specHashMismatch"
  | "handoff.backingMismatch";

export type HandoffErrorKey =
  | "versionMismatch"
  | "invalidArtifact"
  | "specHashMismatch"
  | "backingMismatch";

export interface HandoffVersionMismatchDetails extends ErrorDetails {
  readonly expectedVersion: number;
  readonly receivedVersion: number;
}

export interface HandoffInvalidArtifactDetails extends ErrorDetails {
  readonly detail?: string;
  readonly expectedBytes?: number;
  readonly receivedBytes?: number;
}

export interface HandoffSpecHashMismatchDetails extends ErrorDetails {
  readonly expectedHash: string;
  readonly receivedHash: string;
  readonly localHash: string;
  readonly remoteHash: string;
  readonly diff?: string;
}

export interface HandoffBackingMismatchDetails extends ErrorDetails {
  readonly expectedBytes: number;
  readonly receivedBytes: number;
  readonly local?: number;
  readonly remote?: number;
}

interface HandoffErrorDescriptor<C extends HandoffErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface HandoffErrorsMap {
  versionMismatch: HandoffErrorDescriptor<"handoff.versionMismatch">;
  invalidArtifact: HandoffErrorDescriptor<"handoff.invalidArtifact">;
  specHashMismatch: HandoffErrorDescriptor<"handoff.specHashMismatch">;
  backingMismatch: HandoffErrorDescriptor<"handoff.backingMismatch">;
}

/**
 * Domain-local descriptors used for IDE navigation and as a single
 * source of truth for code, message, and metadata.
 */
const HANDOFF_ERRORS_DEF: HandoffErrorsMap = {
  versionMismatch: {
    code: "handoff.versionMismatch",
    message: "Unexpected handoff version",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  invalidArtifact: {
    code: "handoff.invalidArtifact",
    message: "Unsupported handoff artifact",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  specHashMismatch: {
    code: "handoff.specHashMismatch",
    message: "Spec hash mismatch",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  backingMismatch: {
    code: "handoff.backingMismatch",
    message: "Backing byteLength mismatch",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
} as const;

export const HANDOFF_ERRORS: HandoffErrorsMap = HANDOFF_ERRORS_DEF;

type HandoffCodesFromDescriptors = HandoffErrorsMap[HandoffErrorKey]["code"];
type HandoffCodesEqual = IsExact<HandoffErrorCode, HandoffCodesFromDescriptors>;

/** @internal */
export type _HandoffCodesMatch = AssertTrue<HandoffCodesEqual>;
