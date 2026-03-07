import { describe, expect, it } from "vitest";

import { parseDirectionDashboardQuery } from "@/lib/direction/schemas";

describe("parseDirectionDashboardQuery", () => {
  it("parses supported filters and falls back to defaults", () => {
    expect(
      parseDirectionDashboardQuery({
        owner: " user-1 ",
        lot: " CVC ",
        horizon: "this_week",
        onlyExceptions: "true",
        page: "3",
      })
    ).toEqual({
      ownerUserId: "user-1",
      lot: "CVC",
      horizon: "this_week",
      onlyExceptions: true,
      page: 3,
    });

    expect(
      parseDirectionDashboardQuery({
        horizon: "unknown",
        page: "-4",
      })
    ).toEqual({
      ownerUserId: null,
      lot: null,
      horizon: "all",
      onlyExceptions: false,
      page: 1,
    });
  });
});
