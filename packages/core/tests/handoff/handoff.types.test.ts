import { describe, it, expectTypeOf } from "vitest";

import { type buildHandoff } from "../../src/handoff/handoff";

import type {
  Backing,
  SharedBacking,
  SharedPartitionedBacking,
  WasmSharedBacking,
} from "../../src/backing/types";
import type { Plan } from "../../src/plan/types";
import type { CanonicalSpec } from "@seqlok/schema";

describe("Handoff v1: Type Barrier Contracts", () => {
  it("buildHandoff second parameter is the Backing union (shared | partitioned | wasm)", () => {
    type SecondParam = Parameters<typeof buildHandoff>[1];
    expectTypeOf<SecondParam>().toEqualTypeOf<Backing>();
    expectTypeOf<Backing>().toEqualTypeOf<SecondParam>();
  });

  it("buildHandoff accepts all Backing variants at the type level", () => {
    type SecondParam = Parameters<typeof buildHandoff>[1];

    expectTypeOf<SharedBacking>().toExtend<SecondParam>();
    expectTypeOf<SharedPartitionedBacking>().toExtend<SecondParam>();
    expectTypeOf<WasmSharedBacking>().toExtend<SecondParam>();
  });

  it("buildHandoff preserves the spec type parameter from the Plan", () => {
    interface S extends CanonicalSpec {
      id: "x";
      params: { gain: { kind: "f32"; min: 0; max: 2 } };
      meters: { peak: { kind: "f32" } };
    }

    type P = Plan<S>;
    type Env = ReturnType<typeof buildHandoff<S>>;

    // The handoff should still be tied to Plan<S> / CanonicalSpec S
    expectTypeOf<Env["plan"]>().toEqualTypeOf<P>();
  });
});
