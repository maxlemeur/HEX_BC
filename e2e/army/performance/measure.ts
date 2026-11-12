import type { Browser } from "@e2e-dev/web";

export async function measure(browser: Browser) {
  return browser.evaluate(async () => {
    const entries: Record<string, PerformanceEntry[]> = {};
    const observers: PerformanceObserver[] = [];
    for (const type of ["largest-contentful-paint", "layout-shift", "longtask", "event", "long-animation-frame"]) {
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
    // Long Animation Frames (Chromium 123+): which scripts and how much style/layout made a frame slow.
    type ScriptTiming = PerformanceEntry & {
      invokerType?: string; sourceURL?: string; sourceFunctionName?: string;
      forcedStyleAndLayoutDuration?: number;
    };
    type AnimationFrame = PerformanceEntry & {
      blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number;
      styleDuration?: number; layoutDuration?: number; scripts?: ScriptTiming[];
    };
    const scriptPath = (url: string | undefined) => {
      if (!url) return null;
      try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.pathname : parsed.protocol;
      } catch {
        return null;
      }
    };
    const animationFrames = (entries["long-animation-frame"] ?? []) as AnimationFrame[];
    const longAnimationFrames = [...animationFrames].sort((a, b) => b.duration - a.duration).slice(0, 5).map((frame) => ({
      startMs: frame.startTime,
      durationMs: frame.duration,
      blockingDurationMs: frame.blockingDuration ?? null,
      // Rendering update, from style/layout start to the frame end (paint included); 0 when the
      // frame rendered nothing, null without the field. Style and layout are split where exposed.
      renderUpdateMs: frame.styleAndLayoutStart === undefined ? null
        : frame.styleAndLayoutStart > 0 ? Math.max(0, frame.startTime + frame.duration - frame.styleAndLayoutStart) : 0,
      styleDurationMs: frame.styleDuration ?? null,
      layoutDurationMs: frame.layoutDuration ?? null,
      scripts: [...(frame.scripts ?? [])].sort((a, b) => b.duration - a.duration).slice(0, 3).map((script) => ({
        invokerType: script.invokerType ?? null,
        sourceURL: scriptPath(script.sourceURL),
        sourceFunctionName: script.sourceFunctionName || null,
        durationMs: script.duration,
        forcedStyleAndLayoutDurationMs: script.forcedStyleAndLayoutDuration ?? null,
      })),
    }));
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
      // null when the browser has no Long Animation Frames API (not the same as zero slow frames).
      longAnimationFrameCount: PerformanceObserver.supportedEntryTypes.includes("long-animation-frame") ? animationFrames.length : null,
      longAnimationFrames,
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
