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
      })
    ).toEqual({
      ownerUserId: "user-1",
      lot: "CVC",
      horizon: "this_week",
      onlyExceptions: true,
    });

    expect(
      parseDirectionDashboardQuery({
        horizon: "unknown",
      })
    ).toEqual({
      ownerUserId: null,
      lot: null,
      horizon: "all",
      onlyExceptions: false,
    });
  });
});
