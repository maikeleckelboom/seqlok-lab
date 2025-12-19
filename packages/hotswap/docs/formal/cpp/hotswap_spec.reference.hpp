/**
 * @file hotswap_spec.reference.hpp
 * @brief Reference C++ specification of the @seqlok/hotswap protocol.
 *
 * This is a generic, header-only, templated version used as documentation
 * and for cross-checking the protocol semantics.
 *
 * - NOT installed as part of the public C++ ABI.
 * - For production code, include: <seqlok/hotswap_spec.hpp>
 */

#pragma once

#include <cstdint>
#include <algorithm>

// NOTE: Keep behavior in sync with `include/seqlok/hotswap_spec.hpp`.
// That header defines the concrete EngineKind = uint8_t ABI surface.

namespace seqlok {
namespace hotswap {

// ============================================================================
// Phase Enumeration
// ============================================================================

/**
 * @brief The six phases of the hot-swap lifecycle.
 *
 * Corresponds to TLA+ `Phases` set and TypeScript `SwapPhase` union.
 */
enum class SwapPhase : std::uint8_t {
    Idle      = 0,  ///< No active swap; single engine running
    Spawn     = 1,  ///< Next engine instantiated, not yet processed
    Prime     = 2,  ///< Next engine's first process() call
    Prewarm   = 3,  ///< Warming up next engine (output discarded)
    Crossfade = 4,  ///< Both engines producing output, blending
    Retire    = 5,  ///< Crossfade complete, swap handles
};

// ============================================================================
// Step Kind (Decision)
// ============================================================================

/**
 * @brief What the caller should do this audio block.
 *
 * Returned by stepSwapStateRT to instruct the caller on engine operation.
 */
enum class SwapStepKind : std::uint8_t {
    Idle                     = 0,  ///< No swap active; run current engine only
    RunCurrentOnly           = 1,  ///< Run current engine; next not ready for output
    RunCurrentAndPrewarmNext = 2,  ///< Run both; discard next engine's output
    RunBothForCrossfade      = 3,  ///< Run both; blend outputs
    RetireNow                = 4,  ///< Run current final time; then swap handles
};

// ============================================================================
// RT Ticket
// ============================================================================

/**
 * @brief Compact ticket describing a swap, safe for RT thread ownership.
 *
 * @tparam EngineKind Numeric enum type identifying engine variants.
 *         Must be convertible to/from integer (typically an enum class : uint8_t).
 *
 * All fields are POD; no heap allocation, no pointers.
 */
template <typename EngineKind>
struct SwapTicketRT {
    /// Host-assigned numeric ID. 0 is reserved for "no ticket".
    std::uint64_t ticketId;

    /// Enum value identifying the next engine type.
    EngineKind engineKind;

    /// Absolute frame index where crossfade should start (informational).
    std::int64_t atFrame;

    /// Crossfade length in frames. Must be >= 1.
    std::int64_t fadeFrames;

    /// Number of prewarm blocks before crossfade. May be 0.
    std::int32_t preWarmBlocks;
};

// ============================================================================
// RT Status
// ============================================================================

/**
 * @brief Status snapshot safe to publish from RT thread (e.g., to meters).
 *
 * @tparam EngineKind Numeric enum type identifying engine variants.
 *
 * All fields are POD; suitable for atomic copy or Seqlok meter plane.
 */
template <typename EngineKind>
struct SwapStatusRT {
    SwapPhase phase;
    std::uint64_t ticketId;      ///< 0 = no active ticket
    float progress;              ///< 0.0 to 1.0 over full lifecycle
    EngineKind activeEngineKind; ///< Current engine's kind
    EngineKind nextEngineKind;   ///< Next engine's kind (or sentinel)
};

// ============================================================================
// RT State (Internal)
// ============================================================================

/**
 * @brief Internal protocol state. Mutated by stepSwapStateRT.
 *
 * @tparam EngineKind Numeric enum type identifying engine variants.
 *
 * Callers own this struct and pass it to step functions.
 * Not typically exposed as public API, but stable for cross-language parity.
 */
template <typename EngineKind>
struct SwapStateRT {
    SwapPhase phase;
    bool hasTicket;

    SwapTicketRT<EngineKind> ticket;

    std::int64_t totalFadeFrames;
    std::int64_t fadeFramesRemaining;
    std::int32_t preWarmBlocksRemaining;

    std::int32_t stepIndex;
    std::int32_t stepTotal;
};

// ============================================================================
// Step Decision
// ============================================================================

/**
 * @brief Result of one protocol step: what to do + current status.
 */
template <typename EngineKind>
struct SwapStepDecisionRT {
    SwapStepKind kind;
    SwapStatusRT<EngineKind> status;
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * @brief Initialize RT swap state when a ticket is accepted.
 *
 * Call this when the RT thread receives a valid ticket AND the next engine
 * handle is ready to be used.
 *
 * @param ticket The swap ticket (copied by value).
 * @return Initialized state in `spawn` phase.
 *
 * PRECONDITIONS:
 *   - ticket.fadeFrames >= 1
 *   - ticket.preWarmBlocks >= 0
 *   - ticket.ticketId != 0
 */
template <typename EngineKind>
inline SwapStateRT<EngineKind> initSwapStateRT(
    const SwapTicketRT<EngineKind>& ticket
) {
    const std::int32_t preWarmBlocks = ticket.preWarmBlocks;
    const std::int64_t totalFadeFrames = ticket.fadeFrames;

    // Used only to smooth progress display; does not affect semantics.
    constexpr std::int32_t fadeStepsHint = 16;

    SwapStateRT<EngineKind> state{};
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

// ============================================================================
// Step Function
// ============================================================================

/**
 * @brief Pure RT state machine step.
 *
 * Advances the protocol by one audio block. Mutates `state` in-place.
 *
 * @param state            RT state for a single slot (mutated).
 * @param blockFrames      Number of frames in this audio block.
 * @param activeKind       Kind of the current engine.
 * @param nextKind         Kind of the next engine (or sentinel if none).
 * @param noneKindSentinel Sentinel value representing "no next engine".
 * @return Decision describing what to do this block + status snapshot.
 *
 * RT-SAFE: No allocation, no exceptions, no external calls.
 */
template <typename EngineKind>
inline SwapStepDecisionRT<EngineKind> stepSwapStateRT(
    SwapStateRT<EngineKind>& state,
    std::int32_t blockFrames,
    EngineKind activeKind,
    EngineKind nextKind,
    EngineKind noneKindSentinel
) {
    const std::uint64_t ticketId = state.hasTicket ? state.ticket.ticketId : 0;
    const EngineKind activeEngineKind = activeKind;
    const EngineKind nextEngineKind =
        (state.phase == SwapPhase::Idle || !state.hasTicket)
        ? noneKindSentinel
        : nextKind;

    const float progress = (state.stepTotal > 0)
        ? static_cast<float>(state.stepIndex) / static_cast<float>(state.stepTotal)
        : 0.0f;

    // Helper lambda to construct status
    auto mkStatus = [&](SwapPhase phase) -> SwapStatusRT<EngineKind> {
        return SwapStatusRT<EngineKind>{
            phase,
            ticketId,
            progress,
            activeEngineKind,
            nextEngineKind,
        };
    };

    // Idle or no ticket: return idle decision
    if (!state.hasTicket || state.phase == SwapPhase::Idle) {
        return SwapStepDecisionRT<EngineKind>{
            SwapStepKind::Idle,
            mkStatus(SwapPhase::Idle),
        };
    }

    switch (state.phase) {
        case SwapPhase::Spawn: {
            state.phase = SwapPhase::Prime;
            state.stepIndex += 1;
            return SwapStepDecisionRT<EngineKind>{
                SwapStepKind::RunCurrentOnly,
                mkStatus(SwapPhase::Spawn),
            };
        }

        case SwapPhase::Prime: {
            state.phase = (state.preWarmBlocksRemaining > 0)
                ? SwapPhase::Prewarm
                : SwapPhase::Crossfade;
            state.stepIndex += 1;
            return SwapStepDecisionRT<EngineKind>{
                SwapStepKind::RunCurrentOnly,
                mkStatus(SwapPhase::Prime),
            };
        }

        case SwapPhase::Prewarm: {
            state.preWarmBlocksRemaining -= 1;
            state.stepIndex += 1;

            if (state.preWarmBlocksRemaining <= 0) {
                state.phase = SwapPhase::Crossfade;
            }

            return SwapStepDecisionRT<EngineKind>{
                SwapStepKind::RunCurrentAndPrewarmNext,
                mkStatus(SwapPhase::Prewarm),
            };
        }

        case SwapPhase::Crossfade: {
            state.fadeFramesRemaining = std::max(
                static_cast<std::int64_t>(0),
                state.fadeFramesRemaining - static_cast<std::int64_t>(blockFrames)
            );
            state.stepIndex += 1;

            if (state.fadeFramesRemaining <= 0) {
                state.phase = SwapPhase::Retire;
            }

            return SwapStepDecisionRT<EngineKind>{
                SwapStepKind::RunBothForCrossfade,
                mkStatus(SwapPhase::Crossfade),
            };
        }

        case SwapPhase::Retire: {
            state.phase = SwapPhase::Idle;
            state.hasTicket = false;
            state.stepIndex += 1;

            return SwapStepDecisionRT<EngineKind>{
                SwapStepKind::RetireNow,
                mkStatus(SwapPhase::Retire),
            };
        }

        case SwapPhase::Idle:
        default: {
            // Should not reach here if hasTicket is true, but handle gracefully
            return SwapStepDecisionRT<EngineKind>{
                SwapStepKind::Idle,
                mkStatus(SwapPhase::Idle),
            };
        }
    }
}

// ============================================================================
// Utility: Create Idle State
// ============================================================================

/**
 * @brief Create an idle state with no active ticket.
 *
 * Useful for initializing a slot before any swaps occur.
 *
 * @param defaultTicket A default-constructed ticket (values don't matter).
 * @return State in `idle` phase with hasTicket = false.
 */
template <typename EngineKind>
inline SwapStateRT<EngineKind> createIdleStateRT(
    const SwapTicketRT<EngineKind>& defaultTicket = SwapTicketRT<EngineKind>{}
) {
    SwapStateRT<EngineKind> state{};
    state.phase = SwapPhase::Idle;
    state.hasTicket = false;
    state.ticket = defaultTicket;
    state.totalFadeFrames = 0;
    state.fadeFramesRemaining = 0;
    state.preWarmBlocksRemaining = 0;
    state.stepIndex = 0;
    state.stepTotal = 0;
    return state;
}

// ============================================================================
// Utility: Phase to String (Debug Only)
// ============================================================================

/**
 * @brief Convert phase enum to string literal (for debugging/logging).
 *
 * NOT RT-SAFE if used with logging. Use only in debug builds.
 */
inline constexpr const char* phaseToString(SwapPhase phase) noexcept {
    switch (phase) {
        case SwapPhase::Idle:      return "idle";
        case SwapPhase::Spawn:     return "spawn";
        case SwapPhase::Prime:     return "prime";
        case SwapPhase::Prewarm:   return "prewarm";
        case SwapPhase::Crossfade: return "crossfade";
        case SwapPhase::Retire:    return "retire";
        default:                   return "unknown";
    }
}

/**
 * @brief Convert step kind enum to string literal (for debugging/logging).
 */
inline constexpr const char* stepKindToString(SwapStepKind kind) noexcept {
    switch (kind) {
        case SwapStepKind::Idle:                     return "idle";
        case SwapStepKind::RunCurrentOnly:           return "runCurrentOnly";
        case SwapStepKind::RunCurrentAndPrewarmNext: return "runCurrentAndPrewarmNext";
        case SwapStepKind::RunBothForCrossfade:      return "runBothForCrossfade";
        case SwapStepKind::RetireNow:                return "retireNow";
        default:                                      return "unknown";
    }
}

} // namespace hotswap
} // namespace seqlok
