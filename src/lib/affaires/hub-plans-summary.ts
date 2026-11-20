import type { TakeoffDocumentRecommendation } from "@/lib/takeoff/document-classifier";
import type { TakeoffVisibleJobStatus } from "@/lib/takeoff/visible-status";

export type AffaireHubPlansSummaryData = {
  planSetCount: number;
  planFileCount: number;
  totalSizeBytes: number;
  defaultPlanSetId: string | null;
  defaultPlanSetName?: string | null;
  defaultPlanSetSource?: string | null;
  defaultPlanSetFileCount?: number;
  defaultPlanSetUpdatedAt?: string | null;
  launchRecommendation?: TakeoffDocumentRecommendation | null;
  defaultPlanSetLatestJob?: {
    status: string;
    planSetId?: string | null;
    estimateVersionId?: string | null;
    createdAt?: string;
  } | null;
  latestJob: {
    jobId: string;
    status: TakeoffVisibleJobStatus;
    label: string;
    reviewVersionId: string;
    planSetId?: string | null;
    estimateVersionId?: string;
    createdAt?: string;
  } | null;
  coveragePercent: number | null;
  exceptionCount: number | null;
  openQuestionsCount: number;
  failureReasonLabel: string | null;
};
