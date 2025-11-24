/**
 * @fileoverview
 * Diagnostics public surface.
 *
 * @remarks
 * - Re-exports environment helpers, counters, and view-description tools.
 * - Intended for dev tooling, HUDs, and stress harnesses, not hot-path code.
 * - Safe to tree-shake out in production builds if unused.
 */

export type {
  DiagnosticsCounters,
  DiagnosticsCountersSnapshot,
  DiagnosticsCounterName,
} from "./diagnostics/counters";

export {
  snapshotCounters,
  resetCounters,
  incrementCounter,
  setCounter,
} from "./diagnostics/counters";

export type { EnvKind, EnvSummary } from "./diagnostics/env";

export {
  probeEnv,
  summarizeEnv,
  assertSabSupport,
  assertSabSupportFromSummary,
} from "./diagnostics/env";

export { describeViews } from "./diagnostics/describe-views";
