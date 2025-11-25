// include/seqlok/hotswap_spec.hpp
#pragma once

#include <cstdint>

namespace seqlok::hotswap {

// Phases of the protocol; keep in sync with TS `SwapPhase`.
enum class SwapPhase : std::uint8_t {
  Idle,
  Spawn,
  Prime,
  Prewarm,
  Crossfade,
  Retire,
};

// What the caller should do this block; keep in sync with TS `SwapStepKind`.
enum class SwapStepKind : std::uint8_t {
  Idle,
  RunCurrentOnly,
  RunCurrentAndPrewarmNext,
  RunBothForCrossfade,
  RetireNow,
};

// Numeric engine kind; TS uses `number extends EngineKind`.
using EngineKind = std::uint8_t;

// Compact RT ticket, mirrors `SwapTicketRT<number>`.
struct SwapTicketRT {
  std::uint64_t ticketId;     // 0 = none
  EngineKind engineKind;      // enum value for next engine

  std::int64_t atFrame;       // absolute frame for fade start
  std::int64_t fadeFrames;    // fade length in frames
  std::int32_t preWarmBlocks; // number of prewarm blocks
};

// RT status, mirrors `SwapStatusRT<number>`.
struct SwapStatusRT {
  SwapPhase phase;
  std::uint64_t ticketId;     // 0 = none
  float progress;             // 0..1 over lifecycle
  EngineKind activeEngineKind;
  EngineKind nextEngineKind;  // sentinel for “none”
};

// Internal RT state, mirrors `SwapStateRT<number>`.
struct SwapStateRT {
  SwapPhase phase;
  bool hasTicket;

  SwapTicketRT ticket;

  std::int64_t totalFadeFrames;
  std::int64_t fadeFramesRemaining;
  std::int32_t preWarmBlocksRemaining;

  std::int32_t stepIndex;
  std::int32_t stepTotal;
};

// One step of the protocol; mirrors `initSwapStateRT`.
inline SwapStateRT init_swap_state_rt(const SwapTicketRT& ticket) {
#ifndef NDEBUG
  // mirror TS invariants
  if (ticket.ticketId == 0) {
    // You can use assert() or throw; up to your debug policy.
    // assert(false && "ticketId 0 is reserved for 'no ticket'");
  }
  if (ticket.fadeFrames < 1) {
    // assert(false && "fadeFrames must be >= 1");
  }
  if (ticket.preWarmBlocks < 0) {
    // assert(false && "preWarmBlocks must be >= 0");
  }
#endif

  const std::int32_t preWarmBlocks = ticket.preWarmBlocks;
  const std::int64_t totalFadeFrames = ticket.fadeFrames;
  const std::int32_t fadeStepsHint = 16;

  SwapStateRT state{};
  state.phase = SwapPhase::Spawn;
  state.hasTicket = true;
  state.ticket = ticket;
  state.totalFadeFrames = totalFadeFrames;
  state.fadeFramesRemaining = totalFadeFrames;
  state.preWarmBlocksRemaining = preWarmBlocks;
  state.stepIndex = 0;
  state.stepTotal = 2 + preWarmBlocks + fadeStepsHint + 1;
  return state;
}

// One step, mirrors `stepSwapStateRT`.
struct SwapStepDecisionRT {
  SwapStepKind kind;
  SwapStatusRT status;
};

/**
 * Pure RT state machine step.
 *
 * - Mutates `state` in-place.
 * - Does not allocate.
 * - Does not call into engines or touch buffers.
 *
 * Caller interprets `kind` to decide which engines to run and how to mix.
 */
inline SwapStepDecisionRT step_swap_state_rt(
  SwapStateRT& state,
  std::int32_t blockFrames,
  EngineKind activeKind,
  EngineKind nextKind,
  EngineKind noneKindSentinel
) {
  const std::uint64_t ticketId = state.hasTicket ? state.ticket.ticketId : 0;
  const EngineKind activeEngineKind = activeKind;
  const EngineKind nextEngineKind =
    (!state.hasTicket || state.phase == SwapPhase::Idle)
      ? noneKindSentinel
      : nextKind;

  const float progress =
    (state.stepTotal > 0)
      ? static_cast<float>(state.stepIndex) /
          static_cast<float>(state.stepTotal)
      : 0.0f;

  auto make_status = [&](SwapPhase phase) -> SwapStatusRT {
    return SwapStatusRT{
      phase,
      ticketId,
      progress,
      activeEngineKind,
      nextEngineKind,
    };
  };

  if (!state.hasTicket || state.phase == SwapPhase::Idle) {
    return SwapStepDecisionRT{
      SwapStepKind::Idle,
      make_status(SwapPhase::Idle),
    };
  }

  switch (state.phase) {
    case SwapPhase::Spawn: {
      state.phase = SwapPhase::Prime;
      state.stepIndex += 1;
      return SwapStepDecisionRT{
        SwapStepKind::RunCurrentOnly,
        make_status(SwapPhase::Spawn),
      };
    }
    case SwapPhase::Prime: {
      state.phase = (state.preWarmBlocksRemaining > 0)
        ? SwapPhase::Prewarm
        : SwapPhase::Crossfade;
      state.stepIndex += 1;
      return SwapStepDecisionRT{
        SwapStepKind::RunCurrentOnly,
        make_status(SwapPhase::Prime),
      };
    }
    case SwapPhase::Prewarm: {
      state.preWarmBlocksRemaining -= 1;
      state.stepIndex += 1;
      if (state.preWarmBlocksRemaining <= 0) {
        state.phase = SwapPhase::Crossfade;
      }
      return SwapStepDecisionRT{
        SwapStepKind::RunCurrentAndPrewarmNext,
        make_status(SwapPhase::Prewarm),
      };
    }
    case SwapPhase::Crossfade: {
      if (blockFrames > 0) {
        state.fadeFramesRemaining =
          std::max<std::int64_t>(0, state.fadeFramesRemaining - blockFrames);
      }
      state.stepIndex += 1;
      if (state.fadeFramesRemaining <= 0) {
        state.phase = SwapPhase::Retire;
      }
      return SwapStepDecisionRT{
        SwapStepKind::RunBothForCrossfade,
        make_status(SwapPhase::Crossfade),
      };
    }
    case SwapPhase::Retire: {
      state.phase = SwapPhase::Idle;
      state.hasTicket = false;
      state.stepIndex += 1;
      return SwapStepDecisionRT{
        SwapStepKind::RetireNow,
        make_status(SwapPhase::Retire),
      };
    }
    case SwapPhase::Idle:
      // handled at top
      break;
  }

  // Fallback; should not be reached if switch is exhaustive.
  return SwapStepDecisionRT{
    SwapStepKind::Idle,
    make_status(SwapPhase::Idle),
  };
}

} // namespace seqlok::hotswap
