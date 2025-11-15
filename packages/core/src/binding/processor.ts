/**
 * @fileoverview Processor binding (v2.0 - golden flow only)
 *
 * Public entry-point for creating a processor binding from a ReceivedHandoff.
 *
 * Design:
 * - Processor never sees the spec value; it only consumes the planned layout.
 * - All processor bindings start from `ReceivedHandoff<S>`.
 * - The owner/main side is responsible for:
 *     defineSpec → planLayout → allocateShared → buildHandoff
 *   and the processor side does:
 *     receiveHandoff → bindProcessor(received)
 */

import { processorImpl } from './processor.impl';

import type { ProcessorBinding, ProcessorOptions } from './types';
import type { SharedBacking } from '../backing/types';
import type { ReceivedHandoff } from '../handoff/types';
import type { SpecInput } from '../spec/types';

/**
 * Public processor binding (golden flow).
 *
 * Use this in workers/worklets or same-thread processors where the spec
 * value is not available. The `received.plan` carries all layout information.
 *
 * @template S - Spec type (inferred from ReceivedHandoff<S>)
 * @param received - Validated handoff from receiveHandoff()
 * @param options - Optional processor configuration
 * @returns Typed processor binding
 *
 * @example
 * ```ts
 * // Worker side (spec-free):
 * import { receiveHandoff, bindProcessor } from '@seqlok/core';
 * import type { MySpec } from './spec';  // type-only import
 *
 * type InitMessage = { handoff: Handoff<MySpec> };
 *
 * self.onmessage = (ev: MessageEvent<InitMessage>) => {
 *   const received = receiveHandoff(ev.data.handoff);
 *   //    ^? ReceivedHandoff<MySpec>
 *
 *   const proc = bindProcessor(received);
 *   //    ^? ProcessorBinding<MySpec> ✓
 * };
 * ```
 */
export function bindProcessor<const S extends SpecInput>(
  received: ReceivedHandoff<S>,
  options: ProcessorOptions = {},
): ProcessorBinding<S> {
  const backing: SharedBacking = { kind: 'shared', sab: received.sab };
  return processorImpl(received.plan, backing, options);
}
