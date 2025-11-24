import { describe, expectTypeOf, it } from "vitest";

import type { HandoffSpecHashMismatchDetails } from "../../src/errors/codes/handoff";
import type { TypedArrayName } from "../../src/errors/registry";
import type { ErrorPayload } from "packages/core/src";

describe("Error Payload Shapes (Typed Contracts)", () => {
  it("binding.snapshotIntoTypeMismatch payload", () => {
    type P = ErrorPayload<"binding.snapshotIntoTypeMismatch">;
    interface Required {
      readonly key: string;
      readonly expectedType: TypedArrayName;
      readonly receivedType: string;
      readonly expectedLength: number;
      readonly receivedLength: number;
    }
    expectTypeOf<P>().toExtend<Required>();
  });

  it("binding.snapshotIntoLengthMismatch payload", () => {
    type P = ErrorPayload<"binding.snapshotIntoLengthMismatch">;
    interface Required {
      readonly key: string;
      readonly expectedType: TypedArrayName;
      readonly receivedType: string;
      readonly expectedLength: number;
      readonly receivedLength: number;
    }
    expectTypeOf<P>().toExtend<Required>();
  });

  it("handoff.specHashMismatch payload", () => {
    type P = ErrorPayload<"handoff.specHashMismatch">;
    expectTypeOf<P>().toExtend<HandoffSpecHashMismatchDetails>();
  });
});
