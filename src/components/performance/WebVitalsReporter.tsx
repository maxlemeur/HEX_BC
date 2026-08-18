"use client";

import { useCallback, useRef } from "react";
import { useReportWebVitals } from "next/web-vitals";

import {
  buildWebVitalPayload,
  parseWebVitalsSampleRate,
  shouldSampleWebVitals,
} from "@/lib/performance/web-vitals";

type ReportWebVitalsCallback = Parameters<typeof useReportWebVitals>[0];

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

export function WebVitalsReporter({
  buildId,
}: Readonly<{ buildId?: string | null }>) {
  const sampledRef = useRef<boolean | null>(null);
  const endpoint = process.env.NEXT_PUBLIC_WEB_VITALS_ENDPOINT?.trim() ?? "";
  const sampleRate = parseWebVitalsSampleRate(
    process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE
  );

  const reportWebVital = useCallback<ReportWebVitalsCallback>(
    (metric) => {
      if (!endpoint) return;

      sampledRef.current ??= shouldSampleWebVitals(sampleRate);
      if (!sampledRef.current) return;

      const payload = buildWebVitalPayload({
        metric,
        pathname: window.location.pathname,
        viewportWidth: window.innerWidth,
        buildId,
      });
      sendWebVital(endpoint, JSON.stringify(payload));
    },
    [buildId, endpoint, sampleRate]
  );

  useReportWebVitals(reportWebVital);
  return null;
}
