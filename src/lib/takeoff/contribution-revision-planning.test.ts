import { expect, it } from "vitest";
import { revisionAdditionAnswers } from "@/lib/takeoff/contribution-revision-planning";
import type { ItemSendAnswer } from "@/lib/takeoff/item-send-plan";
import { revisionPartSchema, type RevisionChange } from "@/lib/takeoff/contribution-revision-contracts";

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

it("reads a proof only on a verified-count part in the journal preview", () => {
  const part = { quantity: 1, unit: "u", pages: [2], basis: null, observation_id: null, entry_revision: null };
  for (const kind of ["entered", "measured"]) {
    expect(revisionPartSchema.safeParse({ ...part, kind }).success).toBe(true);
  }
  expect(revisionPartSchema.safeParse({ ...part, kind: "verified_count" }).success).toBe(false);
  expect(revisionPartSchema.parse({ ...part, kind: "verified_count", marks_revision: 2 })).toMatchObject({
    marks_revision: 2,
  });
});

it("uses the reading's observation source for a measured addition", () => {
  const original: ItemSendAnswer = {
    itemId: "B",
    answerId: "R",
    revision: "proof",
    outcome: "measured",
    decision: null,
    entry: null,
    observations: [
      {
        observationId: "vector",
        role: "contribution",
        source: "vector",
        quantity: 2,
        unit: "u",
        page: 3,
        measurementBasis: null,
      },
    ],
  };
  const change = {
    item_id: "B",
    answer_id: "R",
    source: "measured",
    parts: [{ kind: "measured", quantity: 3, unit: "u", pages: [3], observation_id: "vector", basis: null }],
  } as RevisionChange;
  expect(revisionAdditionAnswers([original], [change])[0].observations).toEqual([
    { ...original.observations[0], quantity: 3 },
  ]);
});
