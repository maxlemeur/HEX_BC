import { expect, it } from "vitest";
import { revisionAdditionAnswers } from "@/lib/takeoff/contribution-revision-planning";
import type { ItemSendAnswer } from "@/lib/takeoff/item-send-plan";
import type { RevisionChange } from "@/lib/takeoff/contribution-revision-contracts";

it("projects only added parts, including a count for an originally missing item with a surviving plan entry", () => {
  const original: ItemSendAnswer = {
    itemId: "B",
    answerId: "R",
    revision: "proof",
    outcome: "not_found",
    observations: [],
    decision: null,
    entry: { revision: 3, quantity: 7, unit: "u", included: true, category: "site_survey" },
  };
  const change = {
    item_id: "B",
    answer_id: "R",
    source: "verified_count",
    parts: [{ kind: "verified_count", quantity: 1, unit: "u", pages: [3], marks_revision: 4 }],
  } as RevisionChange;
  const result = revisionAdditionAnswers(
    [{ ...original, itemId: "A", answerId: "already-sent" }, original],
    [change],
  );
  expect(result.map((a) => a.itemId)).toEqual(["B"]);
  expect(result[0]).toMatchObject({
    quantitySource: "verified_count",
    decision: { kind: "accepted" },
    verifiedCount: { quantity: 1, pages: [3], marksRevision: 4 },
  });
  expect(original.decision).toBeNull();
  expect(original.entry?.quantity).toBe(7);
});
