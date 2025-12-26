/**
 * @fileoverview Public surface for the `@seqlok/commands` package.
 *
 * @remarks
 * This package defines the transport-agnostic mailbox contracts and provides
 * a SWSR ring-backed implementation using `@seqlok/primitives`.
 */

export {
  createCommandMailbox,
  attachCommandProducer,
  attachCommandConsumer,
  type CommandMailbox,
  type CommandMailboxConfig,
} from "./swsr-mailbox";

export {
  isDecodeError,
  type CommandCodec,
  type DecodeError,
  type DecodeErrorInvalidPayload,
  type DecodeErrorUnknownCommand,
  type DecodeResult,
} from "./codec";

export type {
  CommandsError,
  CommandsErrorCode,
  CommandsErrorKey,
  CommandsErrorFactory,
} from "./errors/commands";
export { COMMANDS_ERRORS, createCommandsError } from "./errors/commands";

export type {
  BaseCommandMailboxConfig,
  CommandConsumer,
  CommandConsumerHooks,
  CommandDrainStats,
  CommandProducer,
  CommandPushResult,
} from "./mailbox";

export {
  createCommandBus,
  type CommandBus,
  type CommandBusDrainStats,
  type CommandBusHooks,
  type SourceId,
} from "./bus";

export { defineRing } from "./ring-definition";
export type { RingDefinition, RingLayout } from "./ring-definition";
