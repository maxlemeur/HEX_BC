import { expect, it } from "vitest";
import { reconcileRevisionChoices } from "./contribution-revision-choices";
import type { RevisionPreview } from "./contribution-revision-contracts";

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
