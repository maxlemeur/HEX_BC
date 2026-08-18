const UUID_SEGMENT_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export const DEFAULT_WEB_VITALS_SAMPLE_RATE = 0.1;

export type WebVitalRating = "good" | "needs-improvement" | "poor";

export type WebVitalMetricInput = {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating: WebVitalRating;
  navigationType: string;
};

export type WebVitalPayload = {
  id: string;
  name: string;
  value: number;
  delta: number;
  rating: WebVitalRating;
  navigationType: string;
  route: string;
  viewport: "mobile" | "desktop";
  buildId: string | null;
};

export function parseWebVitalsSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_WEB_VITALS_SAMPLE_RATE;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WEB_VITALS_SAMPLE_RATE;
  }

  return Math.min(1, Math.max(0, parsed));
}

export function shouldSampleWebVitals(
  sampleRate: number,
  randomValue = Math.random()
): boolean {
  return sampleRate > 0 && randomValue < Math.min(1, sampleRate);
}

export function normalizeWebVitalsRoute(pathname: string): string {
  const route = pathname.split("?", 1)[0]?.trim() || "/";
  return route.replace(UUID_SEGMENT_PATTERN, "[id]").slice(0, 240);
}

export function buildWebVitalPayload(input: {
  metric: WebVitalMetricInput;
  pathname: string;
  viewportWidth: number;
  buildId?: string | null;
}): WebVitalPayload {
  const { metric } = input;
  return {
    id: metric.id.slice(0, 128),
    name: metric.name.slice(0, 40),
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    navigationType: metric.navigationType.slice(0, 40),
    route: normalizeWebVitalsRoute(input.pathname),
    viewport: input.viewportWidth < 768 ? "mobile" : "desktop",
    buildId: input.buildId?.trim().slice(0, 40) || null,
  };
}
