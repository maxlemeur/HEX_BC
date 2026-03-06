import { describe, expect, it } from "vitest";

import {
  parseApprovalDecisionJournalAuthorSearchParam,
  parseApprovalDecisionJournalStatusSearchParam,
} from "@/lib/estimates/approval-decision-journal";

describe("approval decision journal search params", () => {
  it("parses author ids from scalar or array search params", () => {
    expect(
      parseApprovalDecisionJournalAuthorSearchParam(
        "11111111-1111-4111-8111-111111111111"
      )
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(
      parseApprovalDecisionJournalAuthorSearchParam([
        "22222222-2222-4222-8222-222222222222",
        "ignored",
      ])
    ).toBe("22222222-2222-4222-8222-222222222222");
    expect(parseApprovalDecisionJournalAuthorSearchParam("   ")).toBeNull();
  });

  it("accepts only known decision filters", () => {
    expect(
      parseApprovalDecisionJournalStatusSearchParam("approved_with_reservations")
    ).toBe("approved_with_reservations");
    expect(
      parseApprovalDecisionJournalStatusSearchParam([
        "changes_requested",
        "approved",
      ])
    ).toBe("changes_requested");
    expect(parseApprovalDecisionJournalStatusSearchParam("rejected")).toBeNull();
    expect(parseApprovalDecisionJournalStatusSearchParam("")).toBeNull();
  });
});
