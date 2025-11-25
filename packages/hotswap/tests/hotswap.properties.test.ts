import fc from "fast-check";
import { describe, it } from "vitest";

import {
  createTicketId,
  initSwapStateRT,
  stepSwapStateRT,
  type SwapTicketRT,
} from "../src/spec";

enum EngineKind {
  None = 0,
  A = 1,
  B = 2,
}

/**
 * Helper to build a valid SwapTicketRT<number> from plain scalars.
 *
 * We keep this local to tests to avoid polluting the main API surface.
 */
function buildTicket(
  ticketId: number,
  engineKind: number,
  atFrame: number,
  fadeFrames: number,
  preWarmBlocks: number,
): SwapTicketRT<number> {
  return {
    ticketId: createTicketId(ticketId),
    engineKind,
    atFrame,
    fadeFrames,
    preWarmBlocks,
  };
}

describe("@seqlok/hotswap – invariants (property-based)", () => {
  it("eventually reaches idle for any valid ticket", () => {
    fc.assert(
      fc.property(
        fc.record({
          ticketId: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
          engineKind: fc.integer({ min: 1, max: 255 }),
          atFrame: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          fadeFrames: fc.integer({ min: 1, max: 48_000 }),
          preWarmBlocks: fc.integer({ min: 0, max: 64 }),
        }),
        fc.integer({ min: 1, max: 2048 }), // blockFrames
        (raw, blockFrames) => {
          const ticket = buildTicket(
            raw.ticketId,
            raw.engineKind,
            raw.atFrame,
            raw.fadeFrames,
            raw.preWarmBlocks,
          );

          const state = initSwapStateRT<number>(ticket);

          // Upper bound: spawn + prime + prewarm blocks +
          // fade blocks + a small safety margin.
          const fadeBlocks = Math.ceil(ticket.fadeFrames / blockFrames);
          const maxSteps = 2 + ticket.preWarmBlocks + fadeBlocks + 8;

          let steps = 0;
          while (steps < maxSteps && state.phase !== "idle") {
            stepSwapStateRT(
              state,
              blockFrames,
              EngineKind.A,
              EngineKind.B,
              EngineKind.None,
            );
            steps += 1;
          }

          // If `state.phase` is not idle here, we violated the liveness
          // assumption encoded in the TLA+ spec.
          return state.phase === "idle";
        },
      ),
      {
        numRuns: 200, // bump if you want to push harder
      },
    );
  });

  it("progress is monotonic across steps", () => {
    fc.assert(
      fc.property(
        fc.record({
          ticketId: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
          engineKind: fc.integer({ min: 1, max: 255 }),
          atFrame: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          fadeFrames: fc.integer({ min: 1, max: 48_000 }),
          preWarmBlocks: fc.integer({ min: 0, max: 64 }),
        }),
        fc.integer({ min: 1, max: 2048 }),
        (raw, blockFrames) => {
          const ticket = buildTicket(
            raw.ticketId,
            raw.engineKind,
            raw.atFrame,
            raw.fadeFrames,
            raw.preWarmBlocks,
          );

          const state = initSwapStateRT<number>(ticket);

          let lastProgress = -1;

          // We allow a small epsilon for floating point rounding.
          const epsilon = 1e-6;

          // Walk until idle.
          for (;;) {
            const decision = stepSwapStateRT(
              state,
              blockFrames,
              EngineKind.A,
              EngineKind.B,
              EngineKind.None,
            );

            const { progress } = decision.status;

            if (progress + epsilon < lastProgress) {
              // Non-monotonic progress would violate the reasoning
              // we use to map TLA+ steps to "time".
              return false;
            }

            lastProgress = progress;

            if (state.phase === "idle") {
              break;
            }
          }

          return true;
        },
      ),
      {
        numRuns: 200,
      },
    );
  });
});
