import { describe, expect, it } from "vitest";

import {
  applyLearningBoost,
  assertTrackedFieldName,
  type SuggestionLearningProposal,
} from "@/lib/estimates/suggestion-learning";

function createProposal(
  input: Partial<SuggestionLearningProposal> &
    Pick<
      SuggestionLearningProposal,
      "rule_id" | "field_name" | "corrected_value" | "correction_count"
    >
): SuggestionLearningProposal {
  return {
    rule_id: input.rule_id,
    field_name: input.field_name,
    corrected_value: input.corrected_value,
    correction_count: input.correction_count,
    first_seen_at: input.first_seen_at ?? "2026-02-20T10:00:00.000Z",
    last_seen_at: input.last_seen_at ?? "2026-02-22T10:00:00.000Z",
    review_status: input.review_status ?? null,
    decided_by: input.decided_by ?? null,
    decided_at: input.decided_at ?? null,
    is_active: input.is_active ?? true,
    sample_original_value: input.sample_original_value ?? null,
    sample_item_title: input.sample_item_title ?? null,
  };
}

describe("suggestion learning", () => {
  it("assertTrackedFieldName validates tracked fields", () => {
    expect(assertTrackedFieldName("description")).toBe("description");
    expect(assertTrackedFieldName("supply_type_id")).toBe("supply_type_id");

    expect(() => assertTrackedFieldName("unknown_field")).toThrowError(
      "field_name invalide."
    );
  });

  it("applyLearningBoost prioritizes approved overrides over auto", () => {
    const result = applyLearningBoost({
      proposals: [
        createProposal({
          rule_id: "rule-1",
          field_name: "description",
          corrected_value: "Desc auto",
          correction_count: 7,
          review_status: null,
          last_seen_at: "2026-02-22T12:00:00.000Z",
        }),
        createProposal({
          rule_id: "rule-1",
          field_name: "description",
          corrected_value: "Desc approuvee",
          correction_count: 1,
          review_status: "approved",
          last_seen_at: "2026-02-21T12:00:00.000Z",
        }),
        createProposal({
          rule_id: "rule-1",
          field_name: "k_fo",
          corrected_value: "1.8",
          correction_count: 4,
        }),
      ],
    });

    expect(result["rule-1"]).toBeDefined();
    expect(result["rule-1"]?.overrides.description).toBe("Desc approuvee");
    expect(result["rule-1"]?.overrides.k_fo).toBe(1.8);
    expect(result["rule-1"]?.learning_boost ?? 0).toBeGreaterThan(0);
  });

  it("applyLearningBoost ignores inactive proposals and applies cap", () => {
    const result = applyLearningBoost({
      boostCap: 3,
      proposals: [
        createProposal({
          rule_id: "rule-2",
          field_name: "description",
          corrected_value: "Desc",
          correction_count: 999,
          review_status: "approved",
          is_active: true,
        }),
        createProposal({
          rule_id: "rule-2",
          field_name: "k_mo",
          corrected_value: "2.5",
          correction_count: 999,
          review_status: "approved",
          is_active: true,
        }),
        createProposal({
          rule_id: "rule-2",
          field_name: "category_id",
          corrected_value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          correction_count: 999,
          review_status: "approved",
          is_active: false,
        }),
      ],
    });

    expect(result["rule-2"]).toBeDefined();
    expect(result["rule-2"]?.learning_boost).toBe(3);
    expect(result["rule-2"]?.overrides.category_id).toBeUndefined();
  });
});
