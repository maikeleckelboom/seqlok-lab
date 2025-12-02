import { isSeqlokError } from "@seqlok/base";
import { describe, expect, it } from "vitest";

import {
  createCommandBus,
  createCommandMailbox,
  type CommandBusDrainStats,
  type CommandCodec,
  type CommandConsumer,
  type CommandConsumerHooks,
  type CommandDrainStats,
  type DecodeErrorInvalidPayload,
  type DecodeErrorUnknownCommand,
} from "../src";

import type { SwsrRingLayout } from "@seqlok/primitives";

type TestCommand = { kind: "noop" } | { kind: "set"; value: number };
const TEST_CODEC: CommandCodec<TestCommand> = {
  wordsPerSlot: 2,
  encode(command, dst, wordOffset) {
    if (command.kind === "noop") {
      dst[wordOffset] = 0;
      dst[wordOffset + 1] = 0;
      return;
    }

    // kind === "set"
    dst[wordOffset] = 1;
    dst[wordOffset + 1] = command.value;
  },
  decode(src, wordOffset) {
    const tag = src[wordOffset];

    if (tag === 0) {
      const command: TestCommand = { kind: "noop" };

      return {
        ok: true,
        command,
      };
    }

    if (tag === 1) {
      const value = src[wordOffset + 1];

      if (value === undefined) {
        // With noUncheckedIndexedAccess, this is the safe branch.
        // At runtime this should never happen for a well-formed ring slot,
        // but if it does, it’s definitely an invalid payload.
        return {
          ok: false,
          error: {
            kind: "invalidPayload",
            commandType: "set",
            reason: "missing value word",
          },
        };
      }

      const command: TestCommand = { kind: "set", value };

      return {
        ok: true,
        command,
      };
    }

    return {
      ok: false,
      error: {
        kind: "unknownCommand",
        commandType: `tag:${String(tag)}`,
      },
    };
  },
};

const LAYOUT: SwsrRingLayout = {
  capacity: 8,
  wordsPerSlot: TEST_CODEC.wordsPerSlot,
};

type MockEvent<C> =
  | { kind: "command"; command: C }
  | { kind: "unknown"; error: DecodeErrorUnknownCommand }
  | { kind: "invalid"; error: DecodeErrorInvalidPayload };

function createMockConsumer<C>(
  mailboxId: string,
  events: readonly MockEvent<C>[],
): CommandConsumer<C> {
  return {
    mailboxId,
    get depth() {
      return 0;
    },
    drain(hooks: CommandConsumerHooks<C>): CommandDrainStats {
      let processed = 0;
      let unknownCommand = 0;
      let invalidPayload = 0;

      for (const event of events) {
        if (event.kind === "command") {
          processed += 1;
          hooks.onCommand(event.command);
        } else if (event.kind === "unknown") {
          unknownCommand += 1;
          hooks.onUnknownCommand?.(event.error);
        } else {
          invalidPayload += 1;
          hooks.onInvalidPayload?.(event.error);
        }
      }

      return { processed, unknownCommand, invalidPayload };
    },
  };
}

describe("CommandBus", () => {
  it("fans in commands from multiple sources", () => {
    const bus = createCommandBus<TestCommand>();

    const sourceAEvents: MockEvent<TestCommand>[] = [
      { kind: "command", command: { kind: "noop" } },
      { kind: "command", command: { kind: "set", value: 1 } },
    ];

    const sourceBEvents: MockEvent<TestCommand>[] = [
      { kind: "command", command: { kind: "set", value: 2 } },
    ];

    const consumerA = createMockConsumer<TestCommand>(
      "source-a",
      sourceAEvents,
    );
    const consumerB = createMockConsumer<TestCommand>(
      "source-b",
      sourceBEvents,
    );

    bus.addSource("source-a", consumerA);
    bus.addSource("source-b", consumerB);

    const seen: { sourceId: string; command: TestCommand }[] = [];

    const stats: CommandBusDrainStats = bus.drainAll({
      onCommand(command, sourceId) {
        seen.push({ sourceId, command });
      },
    });

    expect(stats.totalProcessed).toBe(3);
    expect(stats.totalUnknownCommand).toBe(0);
    expect(stats.totalInvalidPayload).toBe(0);

    expect(stats.bySource.get("source-a")?.processed).toBe(2);
    expect(stats.bySource.get("source-b")?.processed).toBe(1);

    expect(seen).toEqual([
      { sourceId: "source-a", command: { kind: "noop" } },
      { sourceId: "source-a", command: { kind: "set", value: 1 } },
      { sourceId: "source-b", command: { kind: "set", value: 2 } },
    ]);
  });

  it("dispatches error hooks with source ids", () => {
    const bus = createCommandBus<TestCommand>();

    const unknownError: DecodeErrorUnknownCommand = {
      kind: "unknownCommand",
      commandType: "weird.command",
    };

    const invalidError: DecodeErrorInvalidPayload = {
      kind: "invalidPayload",
      commandType: "set",
      reason: "bad payload",
    };

    const consumerA = createMockConsumer<TestCommand>("source-a", [
      { kind: "unknown", error: unknownError },
      { kind: "invalid", error: invalidError },
    ]);

    const consumerB = createMockConsumer<TestCommand>("source-b", [
      { kind: "invalid", error: invalidError },
    ]);

    bus.addSource("source-a", consumerA);
    bus.addSource("source-b", consumerB);

    const unknownEvents: { src: string; error: DecodeErrorUnknownCommand }[] =
      [];
    const invalidEvents: { src: string; error: DecodeErrorInvalidPayload }[] =
      [];

    const stats = bus.drainAll({
      onCommand() {
        // no-op
      },
      onUnknownCommand(error, sourceId) {
        unknownEvents.push({ src: sourceId, error });
      },
      onInvalidPayload(error, sourceId) {
        invalidEvents.push({ src: sourceId, error });
      },
    });

    expect(stats.totalProcessed).toBe(0);
    expect(stats.totalUnknownCommand).toBe(1);
    expect(stats.totalInvalidPayload).toBe(2);

    expect(unknownEvents).toEqual([{ src: "source-a", error: unknownError }]);

    expect(invalidEvents).toEqual([
      { src: "source-a", error: invalidError },
      { src: "source-b", error: invalidError },
    ]);
  });

  it("composes with a real SWSR command mailbox", () => {
    const mailboxA = createCommandMailbox<TestCommand>({
      mailboxId: "mailbox-a",
      codec: TEST_CODEC,
      layout: LAYOUT,
    });

    const mailboxB = createCommandMailbox<TestCommand>({
      mailboxId: "mailbox-b",
      codec: TEST_CODEC,
      layout: LAYOUT,
    });

    const bus = createCommandBus<TestCommand>();

    bus.addSource("source-a", mailboxA.consumer);
    bus.addSource("source-b", mailboxB.consumer);

    mailboxA.producer.push({ kind: "noop" });
    mailboxA.producer.push({ kind: "set", value: 1 });
    mailboxB.producer.push({ kind: "set", value: 2 });

    const seen: { sourceId: string; command: TestCommand }[] = [];

    const stats = bus.drainAll({
      onCommand(command, sourceId) {
        seen.push({ sourceId, command });
      },
    });

    expect(stats.totalProcessed).toBe(3);
    expect(stats.totalUnknownCommand).toBe(0);
    expect(stats.totalInvalidPayload).toBe(0);

    expect(seen).toEqual([
      { sourceId: "source-a", command: { kind: "noop" } },
      { sourceId: "source-a", command: { kind: "set", value: 1 } },
      { sourceId: "source-b", command: { kind: "set", value: 2 } },
    ]);
  });

  it("throws commands.duplicateSourceId on duplicate ids", () => {
    const bus = createCommandBus<TestCommand>();

    const consumer = createMockConsumer<TestCommand>("source-a", []);

    bus.addSource("source-a", consumer);

    let thrown: unknown;

    try {
      bus.addSource("source-a", consumer);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(isSeqlokError(thrown)).toBe(true);

    if (!isSeqlokError(thrown)) {
      // Type guard for TS; test already failed if this branch was taken.
      return;
    }

    expect(thrown.code).toBe("commands.duplicateSourceId");
    expect(thrown.details.sourceId).toBe("source-a");
  });
});
