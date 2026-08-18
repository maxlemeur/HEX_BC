import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_VITALS_SAMPLE_RATE,
  buildWebVitalPayload,
  normalizeWebVitalsRoute,
  parseWebVitalsSampleRate,
  shouldSampleWebVitals,
} from "@/lib/performance/web-vitals";

describe("web vitals reporting", () => {
  it("parses and clamps the sample rate", () => {
    expect(parseWebVitalsSampleRate(undefined)).toBe(
      DEFAULT_WEB_VITALS_SAMPLE_RATE
    );
    expect(parseWebVitalsSampleRate("invalid")).toBe(
      DEFAULT_WEB_VITALS_SAMPLE_RATE
    );
    expect(parseWebVitalsSampleRate("-1")).toBe(0);
    expect(parseWebVitalsSampleRate("0.25")).toBe(0.25);
    expect(parseWebVitalsSampleRate("2")).toBe(1);
  });

  it("samples deterministically at the configured boundary", () => {
    expect(shouldSampleWebVitals(0, 0)).toBe(false);
    expect(shouldSampleWebVitals(0.1, 0.09)).toBe(true);
    expect(shouldSampleWebVitals(0.1, 0.1)).toBe(false);
    expect(shouldSampleWebVitals(1, 0.999)).toBe(true);
  });

  it("removes identifiers and query strings from route dimensions", () => {
    expect(
      normalizeWebVitalsRoute(
        "/dashboard/estimates/ad6b09db-6c8d-4df3-af32-948358901be1/edit?tab=all"
      )
    ).toBe("/dashboard/estimates/[id]/edit");
  });

  it("builds a bounded payload without performance entries or user data", () => {
    expect(
      buildWebVitalPayload({
        metric: {
          id: "metric-1",
          name: "LCP",
          value: 1420,
          delta: 100,
          rating: "good",
          navigationType: "navigate",
        },
        pathname:
          "/dashboard/affaires/e206244b-4b90-455a-abe8-dc7df2ae99d8",
        viewportWidth: 390,
        buildId: "abcdef123456",
      })
    ).toEqual({
      id: "metric-1",
      name: "LCP",
      value: 1420,
      delta: 100,
      rating: "good",
      navigationType: "navigate",
      route: "/dashboard/affaires/[id]",
      viewport: "mobile",
      buildId: "abcdef123456",
    });
  });
});
