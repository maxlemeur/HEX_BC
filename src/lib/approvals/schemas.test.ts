import { describe, expect, it } from "vitest";

import { parseApprovalQueueQuery } from "@/lib/approvals/schemas";

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
