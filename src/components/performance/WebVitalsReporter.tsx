"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReportWebVitals } from "next/web-vitals";

import {
  buildWebVitalPayload,
  describeInteractionTarget,
  INP_ATTRIBUTION_METRIC_NAME,
  parseWebVitalsSampleRate,
  shouldSampleWebVitals,
  type WebVitalMetricInput,
} from "@/lib/performance/web-vitals";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

// One attribution INP subscription per page: web-vitals' onINP cannot be removed, so a
// remount of the dashboard layout must not add a second one.
let inpAttributionRequested = false;

function sendWebVital(endpoint: string, body: string) {
  if (navigator.sendBeacon?.(endpoint, body)) {
    return;
  }

  void fetch(endpoint, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}

function describeTargetNode(node: Node): string {
  // An empty string keeps web-vitals from building its default selector, which reads ids.
  return (node instanceof Element ? describeInteractionTarget(node) : null) ?? "";
}

export function WebVitalsReporter({
  buildId,
}: Readonly<{ buildId?: string | null }>) {
  const sampledRef = useRef<boolean | null>(null);
  const endpoint = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT?.trim() ?? "";
  const sampleRate = parseWebVitalsSampleRate(
    process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE
  );

  const isSampled = useCallback(() => {
    sampledRef.current ??= shouldSampleWebVitals(sampleRate);
    return sampledRef.current;
  }, [sampleRate]);

  const reportMetric = useCallback(
    (metric: WebVitalMetricInput) => {
      if (!endpoint || !isSampled()) return;

      const payload = buildWebVitalPayload({
        metric,
        pathname: window.location.pathname,
        viewportWidth: window.innerWidth,
        buildId,
        origin: window.location.origin,
      });
      sendWebVital(endpoint, JSON.stringify(payload));
    },
    [buildId, endpoint, isSampled]
  );

  // Every plain metric is sent, INP included: it is the measure of record.
  const reportWebVital = useCallback<ReportWebVitalsCallback>(
    (metric) => reportMetric(metric),
    [reportMetric]
  );

  useEffect(() => {
    if (!endpoint || !isSampled() || inpAttributionRequested) return;
    inpAttributionRequested = true;
    // Loaded on demand: unsampled sessions and builds without an endpoint never download it.
    // It subscribes late and only recovers buffered interactions of 104 ms or more, so its
    // value can miss a faster one the plain INP saw: it travels in its own record, to
    // explain slow interactions, and never replaces the plain INP. A failed load only
    // loses the attribution.
    import("next/dist/compiled/web-vitals-attribution")
      .then(({ onINP }) => {
        onINP(
          (metric) => reportMetric({ ...metric, name: INP_ATTRIBUTION_METRIC_NAME }),
          { reportSoftNavs: true, generateTarget: describeTargetNode }
        );
      })
      .catch(() => undefined);
  }, [endpoint, isSampled, reportMetric]);

  useReportWebVitals(reportWebVital);
  return null;
}
