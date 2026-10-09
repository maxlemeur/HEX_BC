import { describe, expect, it } from "vitest";

import { formatRuleThreshold, toDisplayedRuleThreshold, toPersistedRuleThreshold } from "@/lib/estimates/rule-threshold";

describe("rule threshold display contract", () => {

  it("round-trips approval thresholds between euros and stored cents", () => {
    expect(toDisplayedRuleThreshold("require_approval", 500_000)).toBe(5_000);
    expect(formatRuleThreshold("require_approval", 500_000)).toContain(
      "5 000",
    );
  });

  it("does not reinterpret non-monetary rule thresholds", () => {
    expect(toPersistedRuleThreshold("min_margin", 1_500)).toBe(1_500);
    expect(toDisplayedRuleThreshold("min_margin", 1_500)).toBe(1_500);
  });
});
