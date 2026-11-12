// Next 16 vendors the web-vitals attribution build without types. `useReportWebVitals`
// uses the standard build only and `experimental.webVitalsAttribution` no longer reaches
// App Router code, so the reporter loads this build itself for INP.
// Shape: web-vitals 6 `onINP` (attribution build, metric ids `v6-…`); only the fields read
// here are declared.
declare module "next/dist/compiled/web-vitals-attribution" {
  import type { InpAttributionInput, WebVitalRating } from "@/lib/performance/web-vitals";

  export type INPMetricWithAttribution = {
    id: string;
    name: "INP";
    value: number;
    delta: number;
    rating: WebVitalRating;
    navigationType: string;
    attribution: InpAttributionInput;
  };

  export type INPAttributionReportOpts = {
    reportAllChanges?: boolean;
    reportSoftNavs?: boolean;
    durationThreshold?: number;
    /** Return value replaces the default selector; nullish falls back to it. */
    generateTarget?: (node: Node) => string | null | undefined;
  };

  export function onINP(
    onReport: (metric: INPMetricWithAttribution) => void,
    opts?: INPAttributionReportOpts
  ): void;
}
