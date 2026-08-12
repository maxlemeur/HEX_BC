import { describe, expect, it } from "vitest";

import {
  estimateApprovalActionSchema,
  parseApprovalQueueQuery,
} from "@/lib/approvals/schemas";

const RULE_ID = "11111111-1111-4111-8111-111111111111";
const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";

describe("estimateApprovalActionSchema", () => {
  it.each(["approve", "reject"] as const)(
    "requires a target for %s",
    (action) => {
      expect(estimateApprovalActionSchema.safeParse({ action }).success).toBe(
        false
      );
    }
  );

  it.each([
    { action: "approve", rule_id: RULE_ID },
    { action: "approve", approval_id: APPROVAL_ID },
    { action: "reject", rule_id: RULE_ID },
    { action: "reject", approval_id: APPROVAL_ID },
    { action: "approve", rule_id: RULE_ID, approval_id: APPROVAL_ID },
  ])("accepts a concrete approval target %#", (payload) => {
    expect(estimateApprovalActionSchema.safeParse(payload).success).toBe(true);
  });

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

describe("parseApprovalQueueQuery", () => {
  it("keeps supported filters and an explicit direction", () => {
    expect(
      parseApprovalQueueQuery({
        sortBy: "margin",
        sortDir: "desc",
        onlyExceptions: "true",
      })
    ).toEqual({
      sortBy: "margin",
      sortDir: "desc",
      onlyExceptions: true,
    });
  });

  it.each([
    ["priority", "desc"],
    ["amount", "desc"],
    ["margin", "asc"],
    ["age", "asc"],
  ] as const)("uses the canonical direction for %s", (sortBy, sortDir) => {
    expect(parseApprovalQueueQuery({ sortBy })).toEqual({
      sortBy,
      sortDir,
      onlyExceptions: false,
    });
  });

  it.each([
    {},
    { sortBy: "unknown", sortDir: "sideways", onlyExceptions: "TRUE" },
    { sortBy: ["amount"], sortDir: ["asc"], onlyExceptions: ["true"] },
  ])("falls back safely for unsupported query values %#", (params) => {
    expect(parseApprovalQueueQuery(params)).toEqual({
      sortBy: "priority",
      sortDir: "desc",
      onlyExceptions: false,
    });
  });
});
