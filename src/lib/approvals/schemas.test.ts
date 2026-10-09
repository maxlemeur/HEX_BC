import { describe, expect, it } from "vitest";

import { estimateApprovalActionSchema } from "@/lib/approvals/schemas";

describe("estimateApprovalActionSchema", () => {
  it.each(["approve", "reject"] as const)(
    "requires a target for %s",
    (action) => {
      expect(estimateApprovalActionSchema.safeParse({ action }).success).toBe(
        false
      );
    }
  );

  it("requires scope_id for every non-project decision comment", () => {
    const result = estimateApprovalActionSchema.safeParse({
      action: "decide",
      decision: "changes_requested",
      comments: [
        {
          scope_type: "line",
          comment: "Preciser le quantitatif.",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("keeps project comments valid without scope_id", () => {
    const result = estimateApprovalActionSchema.safeParse({
      action: "decide",
      decision: "approved_with_reservations",
      comments: [
        {
          scope_type: "project",
          comment: "Accord au niveau du projet.",
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
