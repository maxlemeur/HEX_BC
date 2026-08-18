import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebVitalsReporter } from "@/components/performance/WebVitalsReporter";

const mocks = vi.hoisted(() => ({
  callback: null as ((metric: unknown) => void) | null,
}));

vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (callback: (metric: unknown) => void) => {
    mocks.callback = callback;
  },
}));

describe("WebVitalsReporter", () => {
  const sendBeacon = vi.fn<typeof navigator.sendBeacon>(() => true);

  beforeEach(() => {
    mocks.callback = null;
    sendBeacon.mockClear();
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    window.history.replaceState({}, "", "/");
  });

  it("does not emit metrics until an endpoint is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_VITALS_ENDPOINT", "");
    render(<WebVitalsReporter buildId="abcdef1" />);

    act(() => {
      mocks.callback?.({
        id: "metric-1",
        name: "LCP",
        value: 1200,
        delta: 1200,
        rating: "good",
        navigationType: "navigate",
      });
    });

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("sends a sampled payload without route identifiers", () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_VITALS_ENDPOINT", "/rum");
    vi.stubEnv("NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE", "1");
    window.history.replaceState(
      {},
      "",
      "/dashboard/estimates/ad6b09db-6c8d-4df3-af32-948358901be1/edit"
    );
    render(<WebVitalsReporter buildId="abcdef1" />);

    act(() => {
      mocks.callback?.({
        id: "metric-1",
        name: "LCP",
        value: 1200,
        delta: 1200,
        rating: "good",
        navigationType: "navigate",
      });
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [endpoint, body] = sendBeacon.mock.calls[0] ?? [];
    expect(endpoint).toBe("/rum");
    expect(JSON.parse(String(body))).toMatchObject({
      name: "LCP",
      route: "/dashboard/estimates/[id]/edit",
      buildId: "abcdef1",
    });
  });
});
