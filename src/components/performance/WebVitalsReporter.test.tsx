import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebVitalsReporter } from "@/components/performance/WebVitalsReporter";
import type { WebVitalMetricInput } from "@/lib/performance/web-vitals";

// Only the two browser-metric libraries are replaced: the test drives the metrics they
// would report and reads the beacons the reporter actually sends.
const metricSources = vi.hoisted(() => ({
  plain: null as ((metric: WebVitalMetricInput) => void) | null,
  onINP: vi.fn(),
}));

vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (callback: (metric: WebVitalMetricInput) => void) => {
    metricSources.plain = callback;
  },
}));

vi.mock("next/dist/compiled/web-vitals-attribution", () => ({
  onINP: metricSources.onINP,
}));

const sendBeacon = vi.fn<(endpoint: string, body: string) => boolean>(() => true);

function sentPayloads() {
  return sendBeacon.mock.calls.map(([, body]) => JSON.parse(body) as Record<string, unknown>);
}

function plainInp(value: number): WebVitalMetricInput {
  return {
    id: "v5-plain",
    name: "INP",
    value,
    delta: value,
    rating: value > 200 ? "needs-improvement" : "good",
    navigationType: "navigate",
  };
}

describe("WebVitalsReporter", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_WEB_VITALS_ENDPOINT", "https://vitals.example.test/collect");
    vi.stubEnv("NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE", "1");
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("always sends the plain INP and adds the attribution as a separate record", async () => {
    render(<WebVitalsReporter buildId="build-1" />);
    await waitFor(() => expect(metricSources.onINP).toHaveBeenCalledTimes(1));

    // An 80 ms interaction during the attribution download sits below the 104 ms
    // event buffer: only the plain observer saw it, so its INP must still be sent.
    metricSources.plain?.(plainInp(80));
    const reportAttributed = metricSources.onINP.mock.calls[0]![0] as (metric: WebVitalMetricInput) => void;
    reportAttributed({
      ...plainInp(64),
      id: "v6-attributed",
      attribution: { inputDelay: 4, processingDuration: 40, presentationDelay: 20 },
    });

    expect(sentPayloads()).toEqual([
      expect.objectContaining({ name: "INP", value: 80 }),
      expect.objectContaining({
        name: "INP-attribution",
        value: 64,
        inp: expect.objectContaining({ inputDelay: 4, processingDuration: 40, presentationDelay: 20 }),
      }),
    ]);
    expect(sentPayloads()[0]).not.toHaveProperty("inp");

    // A remount of the dashboard layout must not subscribe the attribution build twice.
    cleanup();
    render(<WebVitalsReporter buildId="build-1" />);
    await Promise.resolve();
    expect(metricSources.onINP).toHaveBeenCalledTimes(1);
  });
});
