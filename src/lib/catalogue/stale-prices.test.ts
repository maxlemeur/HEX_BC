import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALE_PRICE_DAYS,
  isPriceStale,
  parseStalePriceDays,
  priceFreshnessLevel,
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

describe("priceFreshnessLevel", () => {
  const NOW = new Date("2026-02-21T00:00:00.000Z");

  it("returns fresh for a price updated less than 30 days ago", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "2026-02-10T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("fresh");
    expect(result.ageDays).toBe(11);
  });

  it("returns fresh for a price updated exactly today", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "2026-02-21T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("fresh");
    expect(result.ageDays).toBe(0);
  });

  it("returns fresh at the 30-day boundary", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "2026-01-22T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("fresh");
    expect(result.ageDays).toBe(30);
  });

  it("returns aging for a price updated 31 days ago", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "2026-01-21T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("aging");
    expect(result.ageDays).toBe(31);
  });

  it("returns aging at the 90-day boundary", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "2025-11-23T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("aging");
    expect(result.ageDays).toBe(90);
  });

  it("returns stale for a price updated 91 days ago", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "2025-11-22T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("stale");
    expect(result.ageDays).toBe(91);
  });

  it("returns stale for a very old price", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "2023-01-01T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("stale");
    expect(result.ageDays).toBeGreaterThan(365);
  });

  it("falls back to createdAt when updatedAt is null", () => {
    const result = priceFreshnessLevel(
      { updatedAt: null, createdAt: "2026-02-10T00:00:00.000Z" },
      NOW
    );
    expect(result.level).toBe("fresh");
    expect(result.ageDays).toBe(11);
  });

  it("returns fresh with ageDays 0 when both dates are null", () => {
    const result = priceFreshnessLevel(
      { updatedAt: null, createdAt: null },
      NOW
    );
    expect(result.level).toBe("fresh");
    expect(result.ageDays).toBe(0);
  });

  it("returns fresh with ageDays 0 for undefined dates", () => {
    const result = priceFreshnessLevel({}, NOW);
    expect(result.level).toBe("fresh");
    expect(result.ageDays).toBe(0);
  });

  it("returns fresh with ageDays 0 for invalid date strings", () => {
    const result = priceFreshnessLevel(
      { updatedAt: "not-a-date" },
      NOW
    );
    expect(result.level).toBe("fresh");
    expect(result.ageDays).toBe(0);
  });
});
