import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPROVAL_THRESHOLD_EUROS,
  formatRuleThreshold,
  toDisplayedRuleThreshold,
  toPersistedRuleThreshold,
} from "@/lib/estimates/rule-threshold";

describe("rule threshold display contract", () => {
  it("uses a 5,000 EUR HT default approval threshold", () => {
    expect(DEFAULT_APPROVAL_THRESHOLD_EUROS).toBe(5_000);
    expect(
      toPersistedRuleThreshold(
        "require_approval",
        DEFAULT_APPROVAL_THRESHOLD_EUROS,
      ),
    ).toBe(500_000);
  });

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
