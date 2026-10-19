import { afterEach, describe, expect, it, vi } from "vitest";

import { createSuggestionRanker, rankSuggestions, type SuggestionScoringRule } from "@/lib/estimates/suggestion-scoring";

// Isolation gap, defined before implementation: browser title edits cover the
// real save and rank values, but cannot wait 8/31 days to expose a stale recency
// bonus, or retain a hook ranker across a rules snapshot without app-only clocks.
// These checks use the real scorer and a clock, without React or API mocks.
const rule = (id: string, extra: Record<string, unknown> = {}): SuggestionScoringRule => ({
  id, name: id, match_value: "menuiserie", is_active: true, position: 0, ...extra,
});

afterEach(() => vi.useRealTimers());

describe("editor suggestion ranking snapshot cache", () => {
  it("expires on the exact eighth and thirty-first day of a rule's recency", () => {
    vi.useFakeTimers();
    const usedAt = Date.parse("2026-01-01T12:34:56Z");
    const rules = [rule("recent", { last_used_at: new Date(usedAt).toISOString() }), rule("stable", { learning_boost: 2 })];
    const rank = createSuggestionRanker(rules);
    for (const offset of [8 * 86_400_000 - 1, 8 * 86_400_000, 31 * 86_400_000 - 1, 31 * 86_400_000]) {
      vi.setSystemTime(usedAt + offset);
      expect(rank("Menuiseries")).toEqual(rankSuggestions({ title: "Menuiseries", rules }));
    }
    expect(rank("Menuiseries").map(({ rule }) => rule.id)).toEqual(["stable", "recent"]);
  });

  it("keeps limits independent, accepts a fresh learned rule snapshot and protects its cached array", () => {
    const rules = [rule("one"), rule("two", { usage_count: 5 }), rule("three", { learning_boost: 9 })];
    const rank = createSuggestionRanker(rules);
    expect(rank("Menuiseries", 1)).toEqual(rankSuggestions({ title: "Menuiseries", rules, limit: 1 }));
    const ranked = rank("Menuiseries", 5);
    ranked.reverse();
    expect(rank("Menuiseries", 5)).toEqual(rankSuggestions({ title: "Menuiseries", rules, limit: 5 }));
    const changed = rules.map((entry) => entry.id === "one" ? { ...entry, learning_boost: 50 } : entry);
    expect(createSuggestionRanker(changed)("Menuiseries")[0].rule.id).toBe("one");
    expect(rank("Menuiseries")[0].rule.id).toBe("three");
  });
});
