import { describe, expect, it } from "vitest";

import {
  isPriceStale,
} from "@/lib/catalogue/stale-prices";

describe("stale-prices", () => {
  it("evaluates stale dates with the configured threshold", () => {
    const now = new Date("2026-02-21T00:00:00.000Z");

    expect(
      isPriceStale(
        {
          updatedAt: "2025-11-20T00:00:00.000Z",
        },
        90,
        now
      )
    ).toBe(true);

    expect(
      isPriceStale(
        {
          updatedAt: "2025-11-23T00:00:00.000Z",
        },
        90,
        now
      )
    ).toBe(false);
  });
});
