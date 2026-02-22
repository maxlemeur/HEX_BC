import { describe, expect, it } from "vitest";

import {
  rankSuggestionRules,
  scoreSuggestionRule,
  type SuggestionScoringRule,
} from "@/lib/estimates/suggestion-scoring";

type RuleInput = {
  id: string;
  match_value: string;
  usage_count?: number | null;
  learning_boost?: number | string | null;
  is_active?: boolean | null;
  position?: number | null;
};

function createRule(input: RuleInput): SuggestionScoringRule {
  return {
    id: input.id,
    match_value: input.match_value,
    usage_count: input.usage_count ?? 0,
    learning_boost: input.learning_boost ?? 0,
    is_active: input.is_active ?? true,
    position: input.position ?? 0,
  };
}

describe("suggestion scoring", () => {
  it("ranks exact before partial and fuzzy", () => {
    const ranked = rankSuggestionRules(
      "Pose de fenêtres PVC",
      [
        createRule({
          id: "fuzzy",
          match_value: "pose feneetre pvd",
          usage_count: 200,
        }),
        createRule({
          id: "partial",
          match_value: "fenêtres",
          usage_count: 500,
        }),
        createRule({
          id: "exact",
          match_value: "pose de fenetre pvc",
          usage_count: 0,
        }),
      ],
      { limit: 10 }
    );

    expect(ranked.map((entry) => entry.rule.id)).toEqual([
      "exact",
      "partial",
      "fuzzy",
    ]);
    expect(ranked.map((entry) => entry.matchKind)).toEqual([
      "exact",
      "partial",
      "fuzzy",
    ]);
  });

  it("matches fuzzy with accent and plural normalization", () => {
    const scored = scoreSuggestionRule(
      "Réparations des fenêtres",
      createRule({
        id: "fuzzy-accent-plural",
        match_value: "reparation des feneetre",
      })
    );

    expect(scored).not.toBeNull();
    expect(scored?.matchKind).toBe("fuzzy");
    expect(scored?.similarity ?? 0).toBeGreaterThan(0.72);
  });

  it("treats token-in-phrase containment as partial instead of exact", () => {
    const ranked = rankSuggestionRules(
      "PVC",
      [
        createRule({
          id: "phrase",
          match_value: "pose de fenetre pvc",
        }),
        createRule({
          id: "exact",
          match_value: "pvc",
        }),
      ],
      { limit: 10 }
    );

    expect(ranked.map((entry) => entry.rule.id)).toEqual(["exact", "phrase"]);
    expect(ranked.find((entry) => entry.rule.id === "phrase")?.matchKind).toBe(
      "partial"
    );
  });

  it("uses usage_count to rank equal-score rules by frequency", () => {
    const ranked = rankSuggestionRules(
      "Cloison",
      [
        createRule({ id: "low", match_value: "cloison", usage_count: 2 }),
        createRule({ id: "high", match_value: "cloison", usage_count: 9 }),
        createRule({ id: "mid", match_value: "cloison", usage_count: 4 }),
      ],
      { limit: 10 }
    );

    expect(ranked.map((entry) => entry.rule.id)).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });

  it("pushes usage_count=0 to the end when scores are tied", () => {
    const ranked = rankSuggestionRules(
      "Enduit",
      [
        createRule({ id: "zero-second", match_value: "enduit", usage_count: 0, position: 2 }),
        createRule({ id: "non-zero", match_value: "enduit", usage_count: 1, position: 3 }),
        createRule({ id: "zero-first", match_value: "enduit", usage_count: 0, position: 1 }),
      ],
      { limit: 10 }
    );

    expect(ranked.map((entry) => entry.rule.id)).toEqual([
      "non-zero",
      "zero-first",
      "zero-second",
    ]);
  });

  it("applies learning_boost before ranking", () => {
    const ranked = rankSuggestionRules(
      "Isolation thermique",
      [
        createRule({
          id: "frequent-no-boost",
          match_value: "isolation thermique",
          usage_count: 20,
          learning_boost: 0,
        }),
        createRule({
          id: "less-frequent-boosted",
          match_value: "isolation thermique",
          usage_count: 1,
          learning_boost: 12,
        }),
      ],
      { limit: 10 }
    );

    expect(ranked.map((entry) => entry.rule.id)).toEqual([
      "less-frequent-boosted",
      "frequent-no-boost",
    ]);
    expect(ranked[0]?.learningBoost).toBe(12);
  });

  it("keeps usage tie-breakers when final scores are equal after learning_boost", () => {
    const ranked = rankSuggestionRules(
      "Menuiserie",
      [
        createRule({
          id: "high-usage-no-boost",
          match_value: "menuiserie",
          usage_count: 9,
          learning_boost: 0,
          position: 2,
        }),
        createRule({
          id: "low-usage-boosted-to-tie",
          match_value: "menuiserie",
          usage_count: 1,
          learning_boost: "5.592",
          position: 1,
        }),
      ],
      { limit: 10 }
    );

    expect(ranked[0]?.score).toBe(ranked[1]?.score);
    expect(ranked.map((entry) => entry.rule.id)).toEqual([
      "high-usage-no-boost",
      "low-usage-boosted-to-tie",
    ]);
  });

  it("returns only the top 5 ranked suggestions", () => {
    const rules = [
      createRule({ id: "r1", match_value: "bétons", usage_count: 1 }),
      createRule({ id: "r2", match_value: "bétons", usage_count: 7 }),
      createRule({ id: "r3", match_value: "bétons", usage_count: 3 }),
      createRule({ id: "r4", match_value: "bétons", usage_count: 0 }),
      createRule({ id: "r5", match_value: "bétons", usage_count: 9 }),
      createRule({ id: "r6", match_value: "bétons", usage_count: 2 }),
      createRule({ id: "r7", match_value: "bétons", usage_count: 5 }),
    ];

    const ranked = rankSuggestionRules("beton", rules);

    expect(ranked).toHaveLength(5);
    expect(ranked.map((entry) => entry.rule.id)).toEqual([
      "r5",
      "r2",
      "r7",
      "r3",
      "r6",
    ]);
  });
});
