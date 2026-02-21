import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALE_PRICE_DAYS,
  isPriceStale,
  parseStalePriceDays,
} from "@/lib/catalogue/stale-prices";

describe("stale-prices", () => {
  it("uses the default threshold when no value is provided", () => {
    expect(parseStalePriceDays(undefined)).toBe(DEFAULT_STALE_PRICE_DAYS);
    expect(parseStalePriceDays(null)).toBe(DEFAULT_STALE_PRICE_DAYS);
  });

  it("parses numeric values from strings", () => {
    expect(parseStalePriceDays("120")).toBe(120);
    expect(parseStalePriceDays(" 30 ")).toBe(30);
  });

  it("falls back for invalid values", () => {
    expect(parseStalePriceDays("0")).toBe(DEFAULT_STALE_PRICE_DAYS);
    expect(parseStalePriceDays("-1")).toBe(DEFAULT_STALE_PRICE_DAYS);
    expect(parseStalePriceDays("abc")).toBe(DEFAULT_STALE_PRICE_DAYS);
  });

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
