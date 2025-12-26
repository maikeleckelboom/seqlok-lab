/**
 * @fileoverview
 * Error codes and detail types for the RT hot-swap protocol.
 *
 * @remarks
 * - Covers invalid tickets and protocol misuse at the hotswap layer.
 * - Registered into the global error registry as the `hotswap.*` domains.
 */

import {
  buildErrorDomain,
  DOMAIN_IDS,
  type BuiltErrorDomain,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";

/**
 * Details for `hotswap.invalidTicket`.
 *
 * @remarks
 * This is used when a swap ticket violates the protocol preconditions:
 *
 * - `ticketId !== 0`
 * - `fadeFrames >= 1`
 * - `preWarmBlocks >= 0`
 *
 * Callers should treat this as a host/driver bug, not something to recover
 * from silently.
 */
export interface HotswapInvalidTicketDetails extends ErrorDetails {
  /**
   * Short identifier for where the violation was detected, for example
   * `"createTicketId"` or `"initSwapStateRT"`.
   */
  readonly where: string;

  /**
   * Domain-local reason describing which precondition failed.
   */
  readonly reason:
    | "ticketIdOutOfRange"
    | "fadeFramesNonPositive"
    | "preWarmBlocksNegative";

  readonly ticketId?: number;
  readonly atFrame?: number;
  readonly fadeFrames?: number;
  readonly preWarmBlocks?: number;
}

/**
 * Mapping from error keys in this domains to their detail payloads.
 */
interface HotswapDetailsByKey {
  readonly invalidTicket: HotswapInvalidTicketDetails;
}

const HOTSWAP_DEFS = {
  invalidTicket: {
    message: "Hot-swap ticket parameters are invalid",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const;

type HotswapDefs = typeof HOTSWAP_DEFS;

/**
 * Canonical domains descriptor for `hotswap.*`.
 *
 * @remarks
 * Uses the reserved numeric domains id from `DOMAIN_IDS`.
 */
export const HOTSWAP: BuiltErrorDomain<"hotswap", HotswapDefs> =
  buildErrorDomain("hotswap", DOMAIN_IDS.hotswap, HOTSWAP_DEFS);

export type HotswapErrorCode = ErrorCodeOf<typeof HOTSWAP>;
export type HotswapErrorKey = ErrorKeyOf<typeof HOTSWAP>;
export type HotswapError = SeqlokError<HotswapErrorCode>;

export type HotswapErrorDetailsByKey = HotswapDetailsByKey;

/**
 * Registry map used by `@seqlok/introspect` for aggregation and schema export.
 */
export type HotswapErrorsMap = DomainRegistry<"hotswap", HotswapDefs>;

export const HOTSWAP_ERRORS: HotswapErrorsMap =
  HOTSWAP.registry as HotswapErrorsMap;

/**
 * Factory for producing `hotswap.*` errors with strongly typed details.
 */
export const createHotswapError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"hotswap", HotswapDefs>,
  HotswapDetailsByKey
> = HOTSWAP.createError;

export type HotswapErrorFactory = typeof createHotswapError;
