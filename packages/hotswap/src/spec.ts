import { panic } from "@seqlok/base";

import { createHotswapError } from "./errors/hotswap";

/**
 * Branded ticket identifier.
 *
 * - `0` is reserved for "no ticket" and cannot be constructed via this API.
 * - At the type level, you cannot accidentally pass a plain number where
 *   a `TicketId` is expected without going through `createTicketId`.
 */
declare const TicketIdBrand: unique symbol;
export type TicketId = number & { readonly [TicketIdBrand]: never };

/**
 * Construct a `TicketId` from a plain number.
 *
 * Enforces:
 * - `id !== 0`
 * - `id` is finite
 *
 * Violations are reported as `hotswap.invalidTicket`.
 */
export function createTicketId(id: number): TicketId {
  if (!Number.isFinite(id) || id === 0) {
    throw createHotswapError("invalidTicket", {
      where: "hotswap.createTicketId",
      reason: "ticketIdOutOfRange",
      ticketId: id,
    });
  }

  return id as TicketId;
}

/**
 * Phases of the hot-swap protocol for a single engine slot.
 *
 * Must be kept in sync with:
 * - C++ enum `SwapPhase` in `include/seqlok/hotswap_spec.reference.hpp`
 * - TLA+ `phase` domains in `HotSwapProtocol.tla`
 */
export type SwapPhase =
  | "idle"
  | "spawn"
  | "prime"
  | "prewarm"
  | "crossfade"
  | "retire";

/**
 * What the caller should do in the current audio block.
 *
 * Must be kept in sync with:
 * - C++ enum `SwapStepKind` in `include/seqlok/hotswap_spec.reference.hpp`
 */
export type SwapStepKind =
  | "idle"
  | "runCurrentOnly"
  | "runCurrentAndPrewarmNext"
  | "runBothForCrossfade"
  | "retireNow";

/**
 * Compact RT ticket: description of a swap that is safe to copy into
 * an audio-thread-owned slot (no heap, all numeric).
 */
export interface SwapTicketRT<EngineKind extends number> {
  readonly ticketId: TicketId;
  readonly engineKind: EngineKind;
  readonly atFrame: number;
  readonly fadeFrames: number;
  readonly preWarmBlocks: number;
}

/**
 * RT status: safe to publish from the audio thread to an introspect /
 * meter plane (numbers only, no heap allocation).
 */
export interface SwapStatusRT<EngineKind extends number> {
  readonly phase: SwapPhase;
  readonly ticketId: number; // 0 = none

  /**
   * Coarse 0..1 lifecycle progress (UI/telemetry only).
   * Do NOT use for audio-rate ramps.
   */
  readonly progress: number;

  /**
   * The engine kind the caller should treat as "active output" *for this step*.
   *
   * Important: during `retireNow`, this is the newly-committed engine
   * (the former "next") to avoid a one-block snap/pop at the boundary.
   */
  readonly activeEngineKind: EngineKind;

  /**
   * Next engine kind while a swap is in-flight.
   * Caller chooses a sentinel for "none".
   */
  readonly nextEngineKind: EngineKind;

  // 0 outside crossfade.
  readonly fadeTotalFrames: number;
  readonly fadeDoneFramesAtBlockStart: number;
  readonly fadeDoneFramesAtBlockEnd: number;

  // Useful for telemetry/debug (0 if no ticket)
  readonly preWarmBlocksRemaining: number;
}

/**
 * Internal RT state for the protocol.
 */
export interface SwapStateRT<EngineKind extends number> {
  phase: SwapPhase;
  hasTicket: boolean;

  ticket: SwapTicketRT<EngineKind>;

  totalFadeFrames: number;
  fadeFramesRemaining: number;
  preWarmBlocksRemaining: number;

  stepIndex: number;
  stepTotal: number;
}

/**
 * One step of the protocol: given the current RT state and current
 * block size, describe what should happen this block.
 */
export interface SwapStepDecisionRT<EngineKind extends number> {
  readonly kind: SwapStepKind;
  readonly status: SwapStatusRT<EngineKind>;
}

export function initSwapStateRT<EngineKind extends number>(
  ticket: SwapTicketRT<EngineKind>,
): SwapStateRT<EngineKind> {
  if (!Number.isFinite(ticket.fadeFrames) || ticket.fadeFrames < 1) {
    throw createHotswapError("invalidTicket", {
      where: "hotswap.initSwapStateRT",
      reason: "fadeFramesNonPositive",
      ticketId: ticket.ticketId,
      atFrame: ticket.atFrame,
      fadeFrames: ticket.fadeFrames,
      preWarmBlocks: ticket.preWarmBlocks,
    });
  }

  if (!Number.isFinite(ticket.preWarmBlocks) || ticket.preWarmBlocks < 0) {
    throw createHotswapError("invalidTicket", {
      where: "hotswap.initSwapStateRT",
      reason: "preWarmBlocksNegative",
      ticketId: ticket.ticketId,
      atFrame: ticket.atFrame,
      fadeFrames: ticket.fadeFrames,
      preWarmBlocks: ticket.preWarmBlocks,
    });
  }

  if (ticket.ticketId === 0) {
    throw createHotswapError("invalidTicket", {
      where: "hotswap.initSwapStateRT",
      reason: "ticketIdOutOfRange",
      ticketId: ticket.ticketId,
      atFrame: ticket.atFrame,
      fadeFrames: ticket.fadeFrames,
      preWarmBlocks: ticket.preWarmBlocks,
    });
  }

  const preWarmBlocks = ticket.preWarmBlocks;
  const totalFadeFrames = ticket.fadeFrames;

  // Used only to smooth out `progress`; does not affect semantics.
  const fadeStepsHint = 16;

  return {
    phase: "spawn",
    hasTicket: true,
    ticket,
    totalFadeFrames,
    fadeFramesRemaining: totalFadeFrames,
    preWarmBlocksRemaining: preWarmBlocks,
    stepIndex: 0,
    stepTotal: 2 + preWarmBlocks + fadeStepsHint + 1,
  };
}

interface FadeGeometry {
  readonly total: number;
  readonly doneStart: number;
  readonly doneEnd: number;
}

function fadeNone(): FadeGeometry {
  return { total: 0, doneStart: 0, doneEnd: 0 };
}

function clampNonNegativeInt(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return n <= 0 ? 0 : Math.floor(n);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  if (n <= 0) {
    return 0;
  }
  if (n >= 1) {
    return 1;
  }
  return n;
}

export function stepSwapStateRT<EngineKind extends number>(
  state: SwapStateRT<EngineKind>,
  blockFrames: number,
  activeKind: EngineKind,
  nextKind: EngineKind,
  noneKindSentinel: EngineKind,
): SwapStepDecisionRT<EngineKind> {
  const safeBlockFrames = clampNonNegativeInt(blockFrames);

  const ticketId: number = state.hasTicket ? state.ticket.ticketId : 0;
  const progress =
    state.stepTotal > 0 ? clamp01(state.stepIndex / state.stepTotal) : 0;

  const mkStatus = (
    phase: SwapPhase,
    activeEngineKind: EngineKind,
    nextEngineKind: EngineKind,
    fade: FadeGeometry,
    preWarmBlocksRemaining: number,
  ): SwapStatusRT<EngineKind> => ({
    phase,
    ticketId,
    progress,
    activeEngineKind,
    nextEngineKind,
    fadeTotalFrames: fade.total,
    fadeDoneFramesAtBlockStart: fade.doneStart,
    fadeDoneFramesAtBlockEnd: fade.doneEnd,
    preWarmBlocksRemaining,
  });

  if (!state.hasTicket || state.phase === "idle") {
    return {
      kind: "idle",
      status: mkStatus("idle", activeKind, noneKindSentinel, fadeNone(), 0),
    };
  }

  switch (state.phase) {
    case "spawn": {
      state.phase = "prime";
      state.stepIndex += 1;
      return {
        kind: "runCurrentOnly",
        status: mkStatus(
          "spawn",
          activeKind,
          nextKind,
          fadeNone(),
          state.preWarmBlocksRemaining,
        ),
      };
    }

    case "prime": {
      state.phase = state.preWarmBlocksRemaining > 0 ? "prewarm" : "crossfade";
      state.stepIndex += 1;
      return {
        kind: "runCurrentOnly",
        status: mkStatus(
          "prime",
          activeKind,
          nextKind,
          fadeNone(),
          state.preWarmBlocksRemaining,
        ),
      };
    }

    case "prewarm": {
      const remainingAtStart = state.preWarmBlocksRemaining;
      state.preWarmBlocksRemaining = Math.max(0, remainingAtStart - 1);
      state.stepIndex += 1;

      if (state.preWarmBlocksRemaining === 0) {
        state.phase = "crossfade";
      }

      return {
        kind: "runCurrentAndPrewarmNext",
        status: mkStatus(
          "prewarm",
          activeKind,
          nextKind,
          fadeNone(),
          state.preWarmBlocksRemaining,
        ),
      };
    }

    case "crossfade": {
      const total = state.totalFadeFrames;
      const remainingAtStart = state.fadeFramesRemaining;
      const doneStart = Math.max(0, total - remainingAtStart);

      const remainingAfter = Math.max(0, remainingAtStart - safeBlockFrames);
      state.fadeFramesRemaining = remainingAfter;

      const doneEnd = Math.max(0, total - remainingAfter);

      state.stepIndex += 1;

      if (state.fadeFramesRemaining === 0) {
        state.phase = "retire";
      }

      return {
        kind: "runBothForCrossfade",
        status: mkStatus(
          "crossfade",
          activeKind,
          nextKind,
          { total, doneStart, doneEnd },
          state.preWarmBlocksRemaining,
        ),
      };
    }

    case "retire": {
      // Commit boundary: for this step, the newly-activated engine is the one
      // the caller should treat as "active output". This avoids a one-block snap.
      state.phase = "idle";
      state.hasTicket = false;
      state.stepIndex += 1;

      return {
        kind: "retireNow",
        status: mkStatus("retire", nextKind, noneKindSentinel, fadeNone(), 0),
      };
    }

    default: {
      const _exhaustive: never = state.phase;
      panic(`Unhandled swap phase: ${String(_exhaustive)}`);
    }
  }
}
