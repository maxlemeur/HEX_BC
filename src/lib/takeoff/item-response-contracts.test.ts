import { describe, expect, it } from "vitest";
import { parseTakeoffItemBatchPatchResponse } from "@/lib/takeoff/item-response-contracts";
import { takeoffItemFixture, OTHER_ID, LINE_ID, NOW } from "@/lib/takeoff/response-contracts.test-fixtures";

const success = () => ({ item_id: OTHER_ID, success: true, item: takeoffItemFixture() });
const failure = () => ({ item_id: LINE_ID, success: false, error: "Conflit de concurrence" });
const response = () => ({ results: [success(), failure()], succeeded: 1, failed: 1 });

describe("takeoff partial item response contract", () => {
  it("retains ordered partial outcomes and database timestamp precision", () => {
    const data = response();
    expect(parseTakeoffItemBatchPatchResponse(data, [OTHER_ID.toUpperCase(), LINE_ID])).toEqual(data);
    expect(data.results[0]).toMatchObject({ item: { updated_at: NOW } });
  });

  // TI-686 D12: the review shows what an entered quantity rests on (« Saisie : <catégorie> — <note> »), for the saved
  // line and for the partners read again with it; a note stored beyond the write bounds is read as stored.
  it("keeps the category and the note of an entered quantity, in the saved line and in the rule states", () => {
    const entry = { quantity_entered_at: NOW, quantity_entered_by: LINE_ID, quantity_entry_category: "hypothesis",
      quantity_entry_note: "x".repeat(2000) };
    const data = { results: [{ item_id: OTHER_ID, success: true, item: takeoffItemFixture(entry as never) }], succeeded: 1, failed: 0,
      rule_states: [{ item_id: OTHER_ID, rule_results: [], rules_evaluated_at: NOW, rules_stale: false, ...entry }] };
    expect(parseTakeoffItemBatchPatchResponse(data, [OTHER_ID])).toEqual(data);
  });
});
