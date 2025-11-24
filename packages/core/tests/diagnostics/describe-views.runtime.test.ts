import { describe, expect, it } from "vitest";

import { describeViews } from "../../src/diagnostics/describe-views";
import { planLayout } from "../../src/plan/layout";
import { defineSpec } from "../../src/spec/define";

describe("DescribeViews: Layout Visualization", () => {
  it("renders a human-readable ASCII table summarizing plane layouts and total byte usage", () => {
    const spec = defineSpec(({ param, meter }) => ({
      // Define a spec with mixed types to populate multiple planes
      params: {
        rate: param.f32({ min: 0.5, max: 2 }),
        mode: param.i32({ min: 0, max: 4 }),
        flags: param.bool.array({ length: 4 }),
      },
      meters: {
        level: meter.f32(),
        peak: meter.f32(),
      },
    }));

    const plan = planLayout(spec);
    const lines = describeViews(plan);

    // Verify Header Structure
    expect(lines[0]).toBe(
      "Plane  Kind              Present  Length(B)  Offset",
    );
    expect(lines[1]).toBe(
      "-----  ----------------  -------  ---------  ------",
    );

    // Verify Footer: Must report the exact total bytes calculated by the plan
    const totalLine = lines[lines.length - 1];
    expect(totalLine).toBe(`Total backing bytes: ${String(plan.bytesTotal)}`);

    // Verify Content: Ensure active planes are marked with a checkmark
    expect(lines.some((line) => line.includes("✔"))).toBe(true);
  });
});
