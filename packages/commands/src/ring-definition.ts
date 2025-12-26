import type { CommandCodec } from "./codec";
import type { SwsrRingLayout } from "@seqlok/primitives";

/**
 * Layout for a `@seqlok/commands` ring-backed mailbox.
 *
 * @remarks
 * This is a thin alias over the low-level SWSR ring layout.
 */
export type RingLayout = SwsrRingLayout;

/**
 * Pure-data definition for a ring-backed mailbox.
 *
 * @remarks
 * This shape is intentionally used for both:
 * - host -> RT command mailboxes
 * - RT -> host event mailboxes
 *
 * The "direction" is defined by how you wire the backing:
 * producer pushes into the ring, consumer drains it.
 */
export interface RingDefinition<T> {
  readonly mailboxId: string;
  readonly layout: RingLayout;
  readonly codec: CommandCodec<T>;
}

/**
 * Define a mailbox ring.
 *
 * @remarks
 * Identity helper that keeps literal types intact and makes inference pleasant.
 */
export function defineRing<T>(config: RingDefinition<T>): RingDefinition<T> {
  return config;
}
