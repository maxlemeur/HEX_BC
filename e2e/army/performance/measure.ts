import type { Browser } from "@e2e-dev/web";

export async function measure(browser: Browser) {
  return browser.evaluate(async () => {
    const entries: Record<string, PerformanceEntry[]> = {};
    const observers: PerformanceObserver[] = [];
    for (const type of ["largest-contentful-paint", "layout-shift", "longtask", "event"]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver((list) => {
        (entries[type] ??= []).push(...list.getEntries());
      });
      observer.observe({ type, buffered: true, ...(type === "event" ? { durationThreshold: 16 } : {}) });
      observers.push(observer);
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    observers.forEach((observer) => observer.disconnect());
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const paints = performance.getEntriesByType("paint");
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const scripts = resources.filter((resource) => new URL(resource.name).pathname.endsWith(".js"));
    let cls = 0;
    let windowValue = 0;
    let windowStart = 0;
    let lastShift = 0;
    for (const entry of entries["layout-shift"] ?? []) {
      const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
      if (shift.hadRecentInput) continue;
      if (shift.startTime - lastShift > 1_000 || shift.startTime - windowStart > 5_000) {
        windowStart = shift.startTime;
        windowValue = 0;
      }
      windowValue += shift.value;
      cls = Math.max(cls, windowValue);
      lastShift = shift.startTime;
    }
    const longTasks = entries.longtask ?? [];
    const events = (entries.event ?? []) as (PerformanceEntry & { interactionId: number })[];
    return {
      pathname: location.pathname,
      viewport: { width: innerWidth, height: innerHeight },
      userAgent: navigator.userAgent,
      ttfbMs: navigation.responseStart - navigation.startTime,
      fcpMs: paints.find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null,
      lcpMs: entries["largest-contentful-paint"]?.at(-1)?.startTime ?? null,
      cls,
      domContentLoadedMs: navigation.domContentLoadedEventEnd,
      longTaskCount: longTasks.length,
      totalBlockingMs: longTasks.reduce((total, entry) => total + Math.max(0, entry.duration - 50), 0),
      longestTaskMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
      maxEventDurationMs: Math.max(0, ...events.filter((entry) => entry.interactionId > 0).map((entry) => entry.duration)),
      scriptCount: scripts.length,
      scriptEncodedBytes: scripts.reduce((total, entry) => total + entry.encodedBodySize, 0),
      scriptDecodedBytes: scripts.reduce((total, entry) => total + entry.decodedBodySize, 0),
      slowResources: resources.map((entry) => ({
        path: new URL(entry.name).pathname,
        durationMs: entry.duration,
        encodedBytes: entry.encodedBodySize,
      })).sort((a, b) => b.durationMs - a.durationMs).slice(0, 8),
    };
  });
}
