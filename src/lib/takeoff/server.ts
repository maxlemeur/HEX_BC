// Public compatibility facade; domain operations live in their server modules.

export { fetchDpgfTakeoffComparison, fetchTakeoffDpgfSummaryForHub } from "@/lib/takeoff/dpgf-comparison-server";

export { fetchTakeoffLineEvidencePanel } from "@/lib/takeoff/line-evidence-server";

export { getTakeoffPriceSuggestion, requestTakeoffPriceSuggestion, reviewTakeoffPriceSuggestion } from "@/lib/takeoff/price-suggestion-server";

export { createTakeoffJobFromFormData, createTakeoffJobFromPlanSet, findTakeoffJobForPlanSetLaunch, hasAccessibleTakeoffJobForIdempotencyKey } from "@/lib/takeoff/job-creation-server";

export {
  reconcileTakeoffJobNow,
  resubmitTakeoffJob,
  retryTakeoffJob,
  cancelTakeoffJob,
} from "@/lib/takeoff/job-actions-server";

export { listTakeoffJobs, getTakeoffJobDetails } from "./job-read-server";

export {
  parseCompareTakeoffJobsQuery,
  parseGetTakeoffJobDetailsQuery,
  parseListTakeoffJobsQuery,
  parseTakeoffDpgfComparisonQuery,
  parseTakeoffLineEvidencePanelQuery,
  parseTakeoffPriceSuggestionQuery,
  parseTakeoffRiskRadarQuery,
} from "@/lib/takeoff/query-parsers";

export {
  createTakeoffMappingRule,
  deleteTakeoffMappingRule,
  listTakeoffMappingRules,
  updateTakeoffMappingRule,
} from "@/lib/takeoff/mapping-rules-server";

export { compareTakeoffJobs } from "@/lib/takeoff/job-compare-server";

export {
  fetchTakeoffRiskRadar,
  fetchTakeoffActiveRiskAlerts,
  updateTakeoffRiskAlertStatus,
} from "@/lib/takeoff/risk-radar-server";

export {
  saveTakeoffDpgfManualLink,
  saveTakeoffReviewDecision,
} from "@/lib/takeoff/dpgf-review-server";

export { previewTakeoffJobConversion } from "@/lib/takeoff/mapping-preview-server";

export { applyTakeoffJob } from "@/lib/takeoff/apply-server";

export { batchUpdateTakeoffItems } from "@/lib/takeoff/item-patch-server";
