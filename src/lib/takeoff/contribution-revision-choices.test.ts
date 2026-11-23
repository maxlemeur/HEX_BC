import { expect, it } from "vitest";
import { reconcileRevisionChoices } from "./contribution-revision-choices";
import {
  revisionChoicesSchema,
  revisionRequestSchema,
  type RevisionPreview,
} from "./contribution-revision-contracts";

it("keeps an explicit omission and the choice on a surviving typed line when another line disappears", () => {
  const fresh = {
    changes: [{ item_id: "A" }, { item_id: "B" }],
    blockers: [{ reason: "typed_line", line_id: "L", entered: 2, reference: null, retained: 3 }],
  } as RevisionPreview;
  expect(
    reconcileRevisionChoices(
      { leave_out: ["A", "gone"], lines: { L: "keep_entry", other: "use_retained" } },
      fresh,
    ),
  ).toEqual({ leave_out: ["A"], lines: { L: "keep_entry" } });
});

it("canonicalises UUID decisions and preserves the planner’s opaque key and the member’s note", () => {
  const key = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const upper = key.toUpperCase();
  const choices = revisionChoicesSchema.parse({
    lines: { [upper]: "keep_entry" },
    leave_out: [upper],
    additions: { resolutions: [{ key: "Fixture A", choice: { kind: "line", estimate_item_id: upper } }] },
  });
  expect(choices).toEqual({
    lines: { [key]: "keep_entry" },
    leave_out: [key],
    additions: { resolutions: [{ key: "Fixture A", choice: { kind: "line", estimate_item_id: key } }] },
  });
  expect(
    revisionChoicesSchema.safeParse({ lines: { [key]: "keep_entry", [upper]: "use_retained" } }).success,
  ).toBe(false);
  const marks = {
    action: "marks",
    version_id: upper,
    receipt_id: upper,
    command: {
      intentKey: upper,
      revisions: { [upper]: 2 },
      gestures: [{ op: "remove", answer_id: upper, mark_id: upper, reason: "other", note: upper }],
    },
  };
  expect(revisionRequestSchema.parse(marks)).toMatchObject({
    command: {
      intentKey: key,
      revisions: { [key]: 2 },
      gestures: [{ answer_id: key, mark_id: key, note: upper }],
    },
  });
});
