import { describe, expect, it } from "vitest";
import { boundedRuleStates } from "@/lib/takeoff/rules/patch-state-budget";
import type { TakeoffItemRuleState } from "@/lib/takeoff/types";

// A dense overlap can send megabytes on every keystroke. The response must request a paginated refresh rather
// than silently truncate and leave an accepted partner on screen. Byte accounting must include multibyte text.
describe("rule state response budget", () => {
  const state = { item_id: "a", rules_stale: false, rules_evaluated_at: null, rule_results: [] } as TakeoffItemRuleState;
  it("keeps a small response whole", () => expect(boundedRuleStates([state])).toEqual([state]));
  it("requests a refresh rather than returning a prefix of a large response", () => {
    const heavy = { ...state, designation: "漢😀".repeat(40_000) };
    expect(boundedRuleStates([state, heavy])).toBeNull();
  });
  it("bounds the line count before serializing results", () => {
    expect(boundedRuleStates(Array.from({ length: 101 }, () => state))).toBeNull();
  });
});
