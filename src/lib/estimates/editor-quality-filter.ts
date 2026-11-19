import type { EstimateQualityFlagKey } from "@/lib/estimate-quality";

export type EstimateQualityFilter =
  | "all_lines"
  | "with_anomalies"
  | EstimateQualityFlagKey;
