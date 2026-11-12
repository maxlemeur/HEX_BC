"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReportWebVitals } from "next/web-vitals";

import {
  buildWebVitalPayload,
  describeInteractionTarget,
  parseWebVitalsSampleRate,
  shouldSampleWebVitals,
  type WebVitalMetricInput,
} from "@/lib/performance/web-vitals";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

// One attribution INP subscription per page: web-vitals' onINP cannot be removed, so a
// remount of the dashboard layout must not add a second one.
let inpAttribution: "idle" | "loading" | "ready" | "failed" = "idle";
// Plain INP received while the attribution build loads; sent only if that load fails.
let pendingPlainInp: WebVitalMetricInput | null = null;

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

  const reportWebVital = useCallback<ReportWebVitalsCallback>(
    (metric) => {
      // INP comes from the attribution build below; this one is a fallback for its failure.
      if (metric.name === "INP" && inpAttribution !== "failed") {
        if (inpAttribution === "loading") pendingPlainInp = metric;
        return;
      }
      reportMetric(metric);
    },
    [reportMetric]
  );

  useEffect(() => {
    if (!endpoint || !isSampled() || inpAttribution !== "idle") return;
    inpAttribution = "loading";
    // Loaded on demand: unsampled sessions and builds without an endpoint never download it.
    import("next/dist/compiled/web-vitals-attribution")
      .then(({ onINP }) => {
        onINP(reportMetric, { reportSoftNavs: true, generateTarget: describeTargetNode });
        inpAttribution = "ready";
      })
      .catch(() => {
        inpAttribution = "failed";
      })
      .finally(() => {
        // Once loaded, the build reads buffered event entries (104 ms or more): a slow
        // interaction behind this plain INP is reported again, with its attribution.
        if (inpAttribution === "failed" && pendingPlainInp) reportMetric(pendingPlainInp);
        pendingPlainInp = null;
      });
  }, [endpoint, isSampled, reportMetric]);

  useReportWebVitals(reportWebVital);
  return null;
}
