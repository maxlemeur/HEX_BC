import { describe, expect, it } from "vitest";

import { parseApprovalQueueQuery } from "@/lib/approvals/schemas";

describe("parseApprovalQueueQuery", () => {
  it("keeps supported filters", () => {
    expect(
      parseApprovalQueueQuery({ sortBy: "margin", onlyExceptions: "true" })
    ).toEqual({ sortBy: "margin", onlyExceptions: true });
  });

  it.each([
    {},
    { sortBy: "unknown", onlyExceptions: "TRUE" },
    { sortBy: ["amount"], onlyExceptions: ["true"] },
  ])("falls back safely for unsupported query values %#", (params) => {
    expect(parseApprovalQueueQuery(params)).toEqual({
      sortBy: "priority",
      onlyExceptions: false,
    });
  });
});
