import { cache } from "react";

import {
  computeAllSectionTotals,
  computeStoredDiscountCents,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { badRequest, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import {
  getAuthenticatedContext,
  getEstimateSendGating,
  getEstimateSupplierComparisons,
  listEstimateItems,
  listEstimateProjectVersions,
  type ListEstimateProjectVersionsResult,
} from "@/lib/estimates/server";
import {
  ESTIMATE_READINESS_CATEGORY_ORDER,
  type EstimateReadinessCategory,
} from "@/lib/estimates/readiness";
import {
  classifyTakeoffPlanSetSource,
  type TakeoffDocumentRecommendation,
} from "@/lib/takeoff/document-classifier";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { fetchTakeoffDpgfSummaryForHub } from "@/lib/takeoff/server";
import {
  getTakeoffFailureReasonLabel,
  resolveTakeoffVisibleJobStatus,
  type TakeoffVisibleJobStatus,
} from "@/lib/takeoff/visible-status";
import type { Database } from "@/types/database";

import {
  affaireCursorPayloadSchema,
  normalizeAffaireListQuery,
  type AffaireManagerQueueFilter,
  type AffaireCursorPayload,
  type AffaireListQuery,
  type AffairePageSize,
  type AffaireStatus,
  type NormalizedAffaireListQuery,
} from "./schemas";
import { hasDefaultImportPlanSetMarker } from "@/lib/takeoff/default-import-plan-set";
import { fetchAffaireRegisterGateSummary } from "./register-server";

type AffaireContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;

type ListAffairesPageRow =
  Database["public"]["Functions"]["list_affaires_page"]["Returns"][number];
type AffaireCountersRow =
  Database["public"]["Functions"]["get_affaires_counters"]["Returns"][number];
type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type DpgfImportRow = Database["public"]["Tables"]["dpgf_imports"]["Row"];
type DpgfMappingRow = Database["public"]["Tables"]["dpgf_mappings"]["Row"];

export type AffaireListItem = {
  projectId: string;
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  isFavorite: boolean;
  versionCount: number;
  hasCurrentVersion: boolean;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  currentStatus: AffaireStatus | null;
  currentTotalHtCents: number | null;
  currentUpdatedAt: string;
  acceptedVersionId: string | null;
  acceptedVersionNumber: number | null;
  hasDpgf: boolean;
  currentApprovalStatus: string | null;
};

export type AffaireListPageResult = {
  items: AffaireListItem[];
  pageSize: AffairePageSize;
  nextCursor: string | null;
  hasNextPage: boolean;
};

export type AffaireCountersResult = {
  totalCount: number;
  filteredCount: number;
  statusCounts: Record<AffaireStatus, number>;
};

export type AffaireManagerQueueCounts = {
  followUp: number;
  reservations: number;
  revalidation: number;
};

export type AffaireManagerQueueSummary = {
  counts: AffaireManagerQueueCounts;
  incompleteCount: number;
};

export type AffairePageDataResult = {
  list: AffaireListPageResult;
  counters: AffaireCountersResult;
  managerQueue?: AffaireManagerQueueSummary | null;
};

type AffaireHubProjectRow = Pick<
  EstimateProjectRow,
  "id" | "tenant_id" | "user_id" | "name" | "reference" | "client_name" | "is_archived"
>;

type AffaireHubVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "total_ht_cents"
  | "margin_multiplier"
  | "updated_at"
>;

type AffaireHubDpgfImportRow = Pick<
  DpgfImportRow,
  | "id"
  | "filename"
  | "source_format"
  | "status"
  | "created_at"
  | "parse_mode"
  | "row_count"
  | "tenant_id"
  | "project_id"
>;

type AffaireHubDpgfMappingRow = Pick<
  DpgfMappingRow,
  "id" | "status" | "created_at" | "updated_at" | "tenant_id" | "import_id"
>;

export type AffaireHubProject = {
  id: string;
  name: string;
  reference: string | null;
  clientName: string | null;
};

export type AffaireHubVersionSummary = {
  id: string;
  projectId: string;
  versionNumber: number;
  status: AffaireStatus;
  totalHtCents: number;
  marginMultiplier: number;
  marginPercent: number;
  updatedAt: string;
};

export type AffaireHubReadinessStatus =
  | "not_ready"
  | "ready_with_reservations"
  | "ready";

export type AffaireHubReadinessDriverCode =
  | "review_pending"
  | "brief_missing"
  | "brief_to_confirm"
  | "critical_missing_piece"
  | "warning_missing_piece"
  | "client_clarification"
  | "continued_with_hypothesis"
  | "revalidation_required";

export type AffaireHubReadinessDriver = {
  code: AffaireHubReadinessDriverCode;
  source: "intake" | "brief" | "register";
  severity: "critical" | "warning" | "info";
  count: number;
};

export type AffaireHubReadinessResult = {
  status: AffaireHubReadinessStatus;
  workingBasis: "insufficient" | "established";
  allowsContinuation: boolean;
  briefStatus: "missing" | "a_confirmer" | "confirme";
  drivers: AffaireHubReadinessDriver[];
  intake: {
    reviewDocumentsCount: number;
    confirmedMissingPiecesCount: number;
    confirmedCriticalMissingPiecesCount: number;
  };
  register: {
    criticalOpenCount: number;
    clarifyWithClientCount: number;
    continuedWithHypothesisCount: number;
    revalidationRequiredCount: number;
    criticalRevalidationRequiredCount: number;
  };
};

export type AffaireHubSummaryResult = {
  project: AffaireHubProject;
  currentVersion: AffaireHubVersionSummary | null;
  acceptedVersion: AffaireHubVersionSummary | null;
  versionsCount: number;
  lineCount: number;
  hubReadiness?: AffaireHubReadinessResult | null;
};

export type AffaireHubDpgfSourceResult = {
  importId: string;
  filename: string;
  sourceFormat: string;
  importStatus: string;
  mappingStatus: string | null;
  importedAt: string;
  mappingUpdatedAt: string | null;
  parseMode: string;
  rowCount: number;
} | null;

export type AffaireHubPlansSummaryResult = {
  planSetCount: number;
  planFileCount: number;
  totalSizeBytes: number;
  hasLegacyFallback?: boolean;
  defaultPlanSetId: string | null;
  defaultPlanSetName: string | null;
  defaultPlanSetSource: string | null;
  defaultPlanSetFileCount: number;
  defaultPlanSetUpdatedAt: string | null;
  launchRecommendation?: TakeoffDocumentRecommendation | null;
  defaultPlanSetLatestJob?: {
    status: string;
    planSetId: string | null;
    estimateVersionId: string | null;
    createdAt: string;
  } | null;
  latestJob: {
    jobId: string;
    status: TakeoffVisibleJobStatus;
    label: string;
    reviewVersionId: string;
    planSetId: string | null;
    estimateVersionId: string;
    createdAt: string;
  } | null;
  coveragePercent: number | null;
  exceptionCount: number | null;
  openQuestionsCount: number;
  failureReasonLabel: string | null;
};

export type AffaireHubTimelineResult = ListEstimateProjectVersionsResult;

export type AffaireHubPageDataResult = {
  summary: AffaireHubSummaryResult;
  timeline: AffaireHubTimelineResult;
  dpgfSource: AffaireHubDpgfSourceResult;
};

export type MarginSectionBreakdown = {
  sectionId: string;
  sectionTitle: string;
  sectionPosition: number;
  costCents: number;
  saleCents: number;
  marginPercent: number;
  marginEurCents: number;
};

export type MarginVersionPoint = {
  versionNumber: number;
  versionId: string;
  status: string;
  marginMultiplier: number;
  marginPercent: number;
  totalHtCents: number;
};

export type AffaireHubMarginAnalysisResult = {
  global: {
    costCents: number;
    saleCents: number;
    marginPercent: number;
    marginEurCents: number;
    marginMultiplier: number;
  };
  sections: MarginSectionBreakdown[];
  versionEvolution: MarginVersionPoint[];
  currentVersionId: string;
} | null;

type AffaireHubSendGating = Awaited<ReturnType<typeof getEstimateSendGating>>["gating"];
type AffaireHubSendGatingFlag = AffaireHubSendGating["blockingFlags"][number];

export type AffaireSubmissionReadinessStatus =
  | "blocked"
  | "warning"
  | "ready"
  | "unavailable";

export type AffaireSubmissionReadinessGroup = {
  category: EstimateReadinessCategory;
  blockers: AffaireHubSendGatingFlag[];
  alerts: AffaireHubSendGatingFlag[];
  blockerCount: number;
  alertCount: number;
};

export type AffaireSubmissionReadinessResult = {
  status: AffaireSubmissionReadinessStatus;
  blockers: AffaireHubSendGatingFlag[];
  alerts: AffaireHubSendGatingFlag[];
  groups: AffaireSubmissionReadinessGroup[];
  checkedAt: string | null;
  stalePriceDays: number | null;
  errorMessage: string | null;
};

export type AffaireHubFinishLineSummaryResult = {
  versionId: string;
  submissionReadiness?: AffaireSubmissionReadinessResult;
  readyToSend: {
    status: "ready" | "blocked" | "warning" | "waiting" | "unavailable";
    blockingFlags: AffaireHubSendGatingFlag[];
    warningFlags: AffaireHubSendGatingFlag[];
    checkedAt: string | null;
    stalePriceDays: number | null;
    errorMessage: string | null;
  };
  readyToOrder: {
    status: "ready" | "blocked" | "waiting" | "unavailable";
    orderableLinesCount: number;
    coveredLinesCount: number;
    ambiguousLinesCount: number;
    missingPriceLinesCount: number;
    staleLinesCount: number;
    errorMessage: string | null;
  };
};

function toSafeInteger(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toNullableSafeInteger(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  return Buffer.from(padded, "base64").toString("utf8");
}

function encodeAffaireCursor(payload: AffaireCursorPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

function decodeAffaireCursor(cursor: string): AffaireCursorPayload {
  let decoded: unknown;

  try {
    decoded = JSON.parse(fromBase64Url(cursor));
  } catch {
    throw badRequest("Curseur de pagination invalide.", undefined, "BAD_REQUEST");
  }

  const parsed = affaireCursorPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw badRequest("Curseur de pagination invalide.", parsed.error, "BAD_REQUEST");
  }

  return parsed.data;
}

function getOwnerScopeUserId(context: AffaireContext): string | null {
  return context.tenantRole === "admin" || context.tenantRole === "director"
    ? null
    : context.userId;
}

function toAffaireListItem(row: ListAffairesPageRow): AffaireListItem {
  const hasCurrentVersion = row.has_current_version ?? false;

  return {
    projectId: row.project_id,
    projectName: row.project_name,
    projectReference: row.project_reference,
    projectClient: row.project_client,
    isFavorite: (row as Record<string, unknown>).is_favorite === true,
    versionCount: toSafeInteger(row.version_count),
    hasCurrentVersion,
    currentVersionId: row.current_version_id ?? null,
    currentVersionNumber: toNullableSafeInteger(row.current_version_number),
    currentStatus: row.current_status ?? null,
    currentTotalHtCents: toNullableSafeInteger(row.current_total_ht_cents),
    currentUpdatedAt: row.current_updated_at,
    acceptedVersionId: row.accepted_version_id,
    acceptedVersionNumber:
      row.accepted_version_number === null
        ? null
        : toSafeInteger(row.accepted_version_number),
    hasDpgf: row.has_dpgf ?? false,
    currentApprovalStatus: (row as Record<string, unknown>).current_approval_status as string | null ?? null,
  };
}

function hasManagerFollowUpSignal(readiness: AffaireHubReadinessResult | null): boolean {
  if (!readiness) {
    return false;
  }

  return (
    readiness.status === "not_ready" ||
    readiness.drivers.some((driver) => driver.code === "critical_missing_piece")
  );
}

function hasManagerReservationSignal(readiness: AffaireHubReadinessResult | null): boolean {
  return readiness?.status === "ready_with_reservations" && !hasManagerRevalidationSignal(readiness);
}

function hasManagerRevalidationSignal(readiness: AffaireHubReadinessResult | null): boolean {
  if (!readiness) {
    return false;
  }

  return (
    readiness.register.revalidationRequiredCount > 0 ||
    readiness.drivers.some((driver) => driver.code === "revalidation_required")
  );
}

function matchesManagerQueueFilter(
  readiness: AffaireHubReadinessResult | null,
  filter: AffaireManagerQueueFilter
): boolean {
  switch (filter) {
    case "follow_up":
      return hasManagerFollowUpSignal(readiness);
    case "reservations":
      return hasManagerReservationSignal(readiness);
    case "revalidation":
      return hasManagerRevalidationSignal(readiness);
    default:
      return true;
  }
}

function buildManagerQueueCounts(
  readinessByProjectId: Map<string, AffaireHubReadinessResult | null>
): AffaireManagerQueueCounts {
  let followUp = 0;
  let reservations = 0;
  let revalidation = 0;

  readinessByProjectId.forEach((readiness) => {
    if (hasManagerFollowUpSignal(readiness)) {
      followUp += 1;
    }
    if (hasManagerReservationSignal(readiness)) {
      reservations += 1;
    }
    if (hasManagerRevalidationSignal(readiness)) {
      revalidation += 1;
    }
  });

  return {
    followUp,
    reservations,
    revalidation,
  };
}

function buildStatusCounts(items: AffaireListItem[]): Record<AffaireStatus, number> {
  const counts: Record<AffaireStatus, number> = {
    draft: 0,
    sent: 0,
    accepted: 0,
    archived: 0,
  };

  items.forEach((item) => {
    if (item.hasCurrentVersion && item.currentStatus) {
      counts[item.currentStatus] += 1;
      return;
    }

    counts.draft += 1;
  });

  return counts;
}

function isAffaireAfterCursor(
  item: AffaireListItem,
  cursor: AffaireCursorPayload,
  direction: NormalizedAffaireListQuery["dir"]
): boolean {
  if (direction === "desc") {
    return (
      item.currentUpdatedAt.localeCompare(cursor.updatedAt) < 0 ||
      (item.currentUpdatedAt === cursor.updatedAt &&
        item.projectId.localeCompare(cursor.projectId) < 0)
    );
  }

  return (
    item.currentUpdatedAt.localeCompare(cursor.updatedAt) > 0 ||
    (item.currentUpdatedAt === cursor.updatedAt &&
      item.projectId.localeCompare(cursor.projectId) > 0)
  );
}

function paginateAffaireItems(
  items: AffaireListItem[],
  query: NormalizedAffaireListQuery
): AffaireListPageResult {
  const decodedCursor = query.cursor ? decodeAffaireCursor(query.cursor) : null;
  const cursorFilteredItems = decodedCursor
    ? items.filter((item) => isAffaireAfterCursor(item, decodedCursor, query.dir))
    : items;
  const pageItems = cursorFilteredItems.slice(0, query.size);
  const lastItem = pageItems[pageItems.length - 1] ?? null;
  const hasNextPage = cursorFilteredItems.length > query.size;
  const nextCursor =
    hasNextPage && lastItem
      ? encodeAffaireCursor({
          updatedAt: lastItem.currentUpdatedAt,
          projectId: lastItem.projectId,
        })
      : null;

  return {
    items: pageItems,
    pageSize: query.size,
    nextCursor,
    hasNextPage,
  };
}

function normalizeHubTimelinePage(page: number | undefined): number {
  if (page === undefined) return 1;
  if (!Number.isFinite(page) || page < 1) {
    throw badRequest("Le parametre page est invalide.", undefined, "BAD_REQUEST");
  }

  return Math.trunc(page);
}

function toAffaireHubVersionSummary(row: AffaireHubVersionRow): AffaireHubVersionSummary {
  const marginMultiplier = Number.isFinite(row.margin_multiplier)
    ? row.margin_multiplier
    : 1;

  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: toSafeInteger(row.version_number),
    status: row.status,
    totalHtCents: toSafeInteger(row.total_ht_cents),
    marginMultiplier,
    marginPercent: (marginMultiplier - 1) * 100,
    updatedAt: row.updated_at,
  };
}

export function buildAffaireHubReadinessSnapshot(input: {
  lineCount: number;
  briefStatus?: "a_confirmer" | "confirme" | null;
  intakeReadiness?: {
    reviewDocumentsCount: number;
    confirmedMissingPiecesCount: number;
    confirmedCriticalMissingPiecesCount: number;
  } | null;
  registerGateSummary?: {
    criticalOpenEntries: unknown[];
    clarifyWithClientEntries?: unknown[] | null;
    continuedWithHypothesisEntries?: unknown[] | null;
    revalidationRequiredEntries?: unknown[] | null;
    criticalRevalidationRequiredEntries?: unknown[] | null;
  } | null;
}): AffaireHubReadinessResult {
  const briefStatus = input.briefStatus ?? "missing";
  const reviewDocumentsCount = input.intakeReadiness?.reviewDocumentsCount ?? 0;
  const confirmedMissingPiecesCount =
    input.intakeReadiness?.confirmedMissingPiecesCount ?? 0;
  const confirmedCriticalMissingPiecesCount =
    input.intakeReadiness?.confirmedCriticalMissingPiecesCount ?? 0;
  const criticalOpenCount = input.registerGateSummary?.criticalOpenEntries.length ?? 0;
  const clarifyWithClientCount =
    input.registerGateSummary?.clarifyWithClientEntries?.length ?? 0;
  const continuedWithHypothesisCount =
    input.registerGateSummary?.continuedWithHypothesisEntries?.length ?? 0;
  const revalidationRequiredCount =
    input.registerGateSummary?.revalidationRequiredEntries?.length ?? 0;
  const criticalRevalidationRequiredCount =
    input.registerGateSummary?.criticalRevalidationRequiredEntries?.length ?? 0;
  const drivers: AffaireHubReadinessDriver[] = [];

  if (reviewDocumentsCount > 0) {
    drivers.push({
      code: "review_pending",
      source: "intake",
      severity: "critical",
      count: reviewDocumentsCount,
    });
  }

  if (briefStatus === "missing") {
    drivers.push({
      code: "brief_missing",
      source: "brief",
      severity: input.lineCount > 0 ? "warning" : "critical",
      count: 1,
    });
  } else if (briefStatus === "a_confirmer") {
    drivers.push({
      code: "brief_to_confirm",
      source: "brief",
      severity: input.lineCount > 0 ? "warning" : "critical",
      count: 1,
    });
  }

  if (confirmedCriticalMissingPiecesCount > 0) {
    drivers.push({
      code: "critical_missing_piece",
      source: "intake",
      severity: "critical",
      count: confirmedCriticalMissingPiecesCount,
    });
  }

  const warningMissingPiecesCount = Math.max(
    confirmedMissingPiecesCount - confirmedCriticalMissingPiecesCount,
    0
  );
  if (warningMissingPiecesCount > 0) {
    drivers.push({
      code: "warning_missing_piece",
      source: "intake",
      severity: "warning",
      count: warningMissingPiecesCount,
    });
  }

  if (clarifyWithClientCount > 0) {
    drivers.push({
      code: "client_clarification",
      source: "register",
      severity: criticalOpenCount > 0 ? "critical" : "warning",
      count: clarifyWithClientCount,
    });
  }

  if (continuedWithHypothesisCount > 0) {
    drivers.push({
      code: "continued_with_hypothesis",
      source: "register",
      severity: "warning",
      count: continuedWithHypothesisCount,
    });
  }

  if (revalidationRequiredCount > 0) {
    drivers.push({
      code: "revalidation_required",
      source: "register",
      severity:
        criticalRevalidationRequiredCount > 0 ? "critical" : "warning",
      count: revalidationRequiredCount,
    });
  }

  const workingBasisEstablished =
    briefStatus === "confirme" || input.lineCount > 0 || continuedWithHypothesisCount > 0;
  const lacksWorkingBasis =
    briefStatus !== "confirme" &&
    input.lineCount === 0 &&
    continuedWithHypothesisCount === 0;
  const hasCriticalRegisterReservations =
    criticalOpenCount > 0 || criticalRevalidationRequiredCount > 0;

  let status: AffaireHubReadinessStatus = "ready";
  if (reviewDocumentsCount > 0) {
    status = "not_ready";
  } else if (lacksWorkingBasis) {
    status = "not_ready";
  } else if (
    confirmedCriticalMissingPiecesCount > 0 ||
    hasCriticalRegisterReservations
  ) {
    status = workingBasisEstablished ? "ready_with_reservations" : "not_ready";
  } else if (
    warningMissingPiecesCount > 0 ||
    clarifyWithClientCount > 0 ||
    continuedWithHypothesisCount > 0 ||
    revalidationRequiredCount > 0 ||
    briefStatus !== "confirme"
  ) {
    status = "ready_with_reservations";
  }

  return {
    status,
    workingBasis: workingBasisEstablished ? "established" : "insufficient",
    allowsContinuation: status !== "not_ready",
    briefStatus,
    drivers,
    intake: {
      reviewDocumentsCount,
      confirmedMissingPiecesCount,
      confirmedCriticalMissingPiecesCount,
    },
    register: {
      criticalOpenCount,
      clarifyWithClientCount,
      continuedWithHypothesisCount,
      revalidationRequiredCount,
      criticalRevalidationRequiredCount,
    },
  };
}

export function buildAffaireSubmissionReadinessSnapshot(input: {
  blockingFlags: AffaireHubSendGatingFlag[];
  warningFlags: AffaireHubSendGatingFlag[];
  checkedAt: string | null;
  stalePriceDays: number | null;
  errorMessage: string | null;
}): AffaireSubmissionReadinessResult {
  const groups = ESTIMATE_READINESS_CATEGORY_ORDER.map((category) => {
    const blockers = input.blockingFlags.filter((flag) => flag.category === category);
    const alerts = input.warningFlags.filter((flag) => flag.category === category);
    return {
      category,
      blockers,
      alerts,
      blockerCount: blockers.length,
      alertCount: alerts.length,
    } satisfies AffaireSubmissionReadinessGroup;
  }).filter((group) => group.blockerCount > 0 || group.alertCount > 0);

  const status: AffaireSubmissionReadinessStatus =
    input.errorMessage
      ? "unavailable"
      : input.blockingFlags.length > 0
        ? "blocked"
        : input.warningFlags.length > 0
          ? "warning"
          : "ready";

  return {
    status,
    blockers: input.blockingFlags,
    alerts: input.warningFlags,
    groups,
    checkedAt: input.checkedAt,
    stalePriceDays: input.stalePriceDays,
    errorMessage: input.errorMessage,
  };
}

const PLAN_FILE_SUM_BATCH_SIZE = 500;
const AFFAIRE_PROJECT_VERSIONS_BATCH_SIZE = 1000;

async function fetchAffaireHubProjectOrThrow(
  context: AffaireContext,
  projectId: string
): Promise<AffaireHubProjectRow> {
  let query = context.supabase
    .from("estimate_projects")
    .select("id, tenant_id, user_id, name, reference, client_name, is_archived")
    .eq("id", projectId)
    .eq("tenant_id", context.tenantId)
    .eq("is_archived", false);

  const ownerScopeUserId = getOwnerScopeUserId(context);
  if (ownerScopeUserId) {
    query = query.eq("user_id", ownerScopeUserId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le projet affaire.");
  }

  const project = (data ?? null) as AffaireHubProjectRow | null;
  if (!project) {
    throw notFound("Affaire introuvable.");
  }

  return project;
}

async function fetchAffaireHubSummaryWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubSummaryResult> {
  const [versionsCountResult, currentVersionResult, acceptedVersionResult] = await Promise.all([
    context.supabase
      .from("estimate_versions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("project_id", project.id)
      .limit(1),
    context.supabase
      .from("estimate_versions")
      .select(
        "id, project_id, version_number, status, total_ht_cents, margin_multiplier, updated_at"
      )
      .eq("tenant_id", context.tenantId)
      .eq("project_id", project.id)
      .order("version_number", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("estimate_versions")
      .select(
        "id, project_id, version_number, status, total_ht_cents, margin_multiplier, updated_at"
      )
      .eq("tenant_id", context.tenantId)
      .eq("project_id", project.id)
      .eq("status", "accepted")
      .order("version_number", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (versionsCountResult.error) {
    throw mapSupabaseError(
      versionsCountResult.error,
      "Impossible de compter les versions affaire."
    );
  }

  if (currentVersionResult.error) {
    throw mapSupabaseError(
      currentVersionResult.error,
      "Impossible de charger la version courante."
    );
  }

  if (acceptedVersionResult.error) {
    throw mapSupabaseError(
      acceptedVersionResult.error,
      "Impossible de charger la derniere version acceptee."
    );
  }

  const currentVersion = (currentVersionResult.data ?? null) as AffaireHubVersionRow | null;
  const acceptedVersion = (acceptedVersionResult.data ?? null) as AffaireHubVersionRow | null;

  let lineCount = 0;
  let hubReadiness: AffaireHubReadinessResult | null = null;
  if (currentVersion) {
    const [{ count, error }, intakeResult, registerGateSummaryResult] = await Promise.all([
      context.supabase
        .from("estimate_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .eq("version_id", currentVersion.id)
        .eq("item_type", "line")
        .limit(1),
      Promise.resolve(fetchAffaireIntakeWorkspace(project.id)).catch(() => null),
      Promise.resolve(
        fetchAffaireRegisterGateSummary({
          supabase: context.supabase as never,
          projectId: project.id,
          versionId: currentVersion.id,
        })
      ).catch(() => null),
    ]);

    if (error) {
      throw mapSupabaseError(error, "Impossible de compter les lignes de la version.");
    }

    lineCount = count ?? 0;

    if (intakeResult && registerGateSummaryResult) {
      hubReadiness = buildAffaireHubReadinessSnapshot({
        lineCount,
        briefStatus: intakeResult.briefDraft?.status ?? null,
        intakeReadiness: intakeResult.readiness
          ? {
              reviewDocumentsCount: intakeResult.readiness.reviewDocumentsCount,
              confirmedMissingPiecesCount:
                intakeResult.readiness.confirmedMissingPiecesCount,
              confirmedCriticalMissingPiecesCount:
                intakeResult.readiness.confirmedCriticalMissingPiecesCount,
            }
          : null,
        registerGateSummary: registerGateSummaryResult,
      });
    }
  } else {
    const [intakeResult, registerGateSummaryResult] = await Promise.all([
      Promise.resolve(fetchAffaireIntakeWorkspace(project.id)).catch(() => null),
      Promise.resolve(
        fetchAffaireRegisterGateSummary({
          supabase: context.supabase as never,
          projectId: project.id,
          versionId: null,
        })
      ).catch(() => null),
    ]);

    if (intakeResult && registerGateSummaryResult) {
      hubReadiness = buildAffaireHubReadinessSnapshot({
        lineCount: 0,
        briefStatus: intakeResult.briefDraft?.status ?? null,
        intakeReadiness: intakeResult.readiness
          ? {
              reviewDocumentsCount: intakeResult.readiness.reviewDocumentsCount,
              confirmedMissingPiecesCount:
                intakeResult.readiness.confirmedMissingPiecesCount,
              confirmedCriticalMissingPiecesCount:
                intakeResult.readiness.confirmedCriticalMissingPiecesCount,
            }
          : null,
        registerGateSummary: registerGateSummaryResult,
      });
    }
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      reference: project.reference,
      clientName: project.client_name,
    },
    currentVersion: currentVersion ? toAffaireHubVersionSummary(currentVersion) : null,
    acceptedVersion: acceptedVersion ? toAffaireHubVersionSummary(acceptedVersion) : null,
    versionsCount: versionsCountResult.count ?? 0,
    lineCount,
    hubReadiness,
  };
}

async function fetchAffaireHubDpgfSourceWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubDpgfSourceResult> {
  const { data: importData, error: importError } = await context.supabase
    .from("dpgf_imports")
    .select(
      "id, filename, source_format, status, created_at, parse_mode, row_count, tenant_id, project_id"
    )
    .eq("tenant_id", context.tenantId)
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (importError) {
    throw mapSupabaseError(importError, "Impossible de charger la source DPGF.");
  }

  const latestImport = (importData ?? null) as AffaireHubDpgfImportRow | null;
  if (!latestImport) {
    return null;
  }

  const { data: mappingData, error: mappingError } = await context.supabase
    .from("dpgf_mappings")
    .select("id, status, created_at, updated_at, tenant_id, import_id")
    .eq("tenant_id", context.tenantId)
    .eq("import_id", latestImport.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (mappingError) {
    throw mapSupabaseError(mappingError, "Impossible de charger le statut de mapping DPGF.");
  }

  const latestMapping = (mappingData ?? null) as AffaireHubDpgfMappingRow | null;

  return {
    importId: latestImport.id,
    filename: latestImport.filename,
    sourceFormat: latestImport.source_format,
    importStatus: latestImport.status,
    mappingStatus: latestMapping?.status ?? null,
    importedAt: latestImport.created_at,
    mappingUpdatedAt: latestMapping?.updated_at ?? null,
    parseMode: latestImport.parse_mode,
    rowCount: toSafeInteger(latestImport.row_count),
  };
}

async function resolveTakeoffReviewVersionId(input: {
  context: AffaireContext;
  projectId: string;
  sourceVersionId: string;
  jobId: string;
  currentVersionId?: string | null;
}) {
  const currentVersionId =
    input.currentVersionId !== undefined
      ? input.currentVersionId
      : await (async () => {
          const { data: currentVersionData, error: currentVersionError } =
            await input.context.supabase
              .from("estimate_versions" as never)
              .select("id" as never)
              .eq("tenant_id" as never, input.context.tenantId as never)
              .eq("project_id" as never, input.projectId as never)
              .order("version_number" as never, { ascending: false })
              .order("updated_at" as never, { ascending: false })
              .limit(1)
              .maybeSingle();

          if (currentVersionError) {
            throw mapSupabaseError(
              currentVersionError,
              "Impossible de resoudre la version courante pour la revue takeoff."
            );
          }

          const currentVersionRow = (currentVersionData ?? null) as { id: string } | null;
          return currentVersionRow && typeof currentVersionRow.id === "string"
            ? currentVersionRow.id
            : null;
        })();

  if (!currentVersionId || currentVersionId === input.sourceVersionId) {
    return input.sourceVersionId;
  }

  const { data: linkData, error: linkError } = await input.context.supabase
    .from("takeoff_version_links" as never)
    .select("target_version_id" as never)
    .eq("tenant_id" as never, input.context.tenantId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .eq("target_version_id" as never, currentVersionId as never)
    .limit(1)
    .maybeSingle();

  if (linkError) {
    throw mapSupabaseError(
      linkError,
      "Impossible de resoudre la version de revue takeoff."
    );
  }

  return linkData ? currentVersionId : input.sourceVersionId;
}

async function fetchAffaireHubPlansSummaryWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubPlansSummaryResult> {
  const [planSetsResult, latestJobResult, currentVersionResult] = await Promise.all([
    context.supabase
      .from("plan_sets" as never)
      .select("id, name, metadata, estimate_version_id, created_at" as never, { count: "exact" })
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("project_id" as never, project.id as never),
    context.supabase
      .from("takeoff_jobs" as never)
      .select(
        "id, status, level, processing_strategy, provider_batch_state, source_file_name, created_at, error_code, error_message, estimate_version_id, plan_set_id, estimate_versions!inner(project_id)" as never
      )
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("estimate_versions.project_id" as never, project.id as never)
      .order("created_at" as never, { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.supabase
      .from("estimate_versions" as never)
      .select("id" as never)
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("project_id" as never, project.id as never)
      .order("version_number" as never, { ascending: false })
      .order("updated_at" as never, { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (planSetsResult.error) {
    throw mapSupabaseError(
      planSetsResult.error,
      "Impossible de compter les jeux de plans."
    );
  }

  if (latestJobResult.error) {
    throw mapSupabaseError(latestJobResult.error, "Impossible de charger le dernier job takeoff.");
  }
  if (currentVersionResult.error) {
    throw mapSupabaseError(
      currentVersionResult.error,
      "Impossible de charger la version courante du registre affaire."
    );
  }

  const currentVersionId =
    currentVersionResult.data &&
    typeof (currentVersionResult.data as { id?: unknown }).id === "string"
      ? ((currentVersionResult.data as { id: string }).id)
      : null;

  const planSetRows = (planSetsResult.data ?? []) as Array<{
    id: string;
    name: string | null;
    metadata: unknown;
    estimate_version_id: string | null;
    created_at: string | null;
  }>;
  const planSetCount = planSetsResult.count ?? planSetRows.length;
  const hasLegacyFallback = planSetRows.some(
    (planSet) => typeof planSet.estimate_version_id === "string"
  );
  const sortedPlanSetRows = [...planSetRows].sort((a, b) => {
    const aCreatedAt = a.created_at ?? "";
    const bCreatedAt = b.created_at ?? "";

    if (aCreatedAt !== bCreatedAt) {
      return bCreatedAt.localeCompare(aCreatedAt);
    }

    return a.id.localeCompare(b.id);
  });

  const currentDraftPlanSetRows =
    currentVersionId !== null
      ? sortedPlanSetRows.filter((ps) => ps.estimate_version_id === currentVersionId)
      : [];

  const autoProposePlanSetRows =
    currentDraftPlanSetRows.length > 0 ? currentDraftPlanSetRows : sortedPlanSetRows;

  // Find best plan set for auto-propose (import marker or latest draft row)
  let defaultPlanSetId: string | null = null;
  let defaultPlanSetName: string | null = null;
  let defaultPlanSetSource: string | null = null;
  if (autoProposePlanSetRows.length > 0) {
    const markedSet = autoProposePlanSetRows.find((ps) =>
      hasDefaultImportPlanSetMarker(ps.metadata),
    );
    const defaultPlanSet = markedSet ?? autoProposePlanSetRows[0];
    defaultPlanSetId = defaultPlanSet.id;
    defaultPlanSetName = defaultPlanSet.name?.trim() || null;
    const metadata =
      defaultPlanSet.metadata && typeof defaultPlanSet.metadata === "object"
        ? (defaultPlanSet.metadata as Record<string, unknown>)
        : null;
    defaultPlanSetSource =
      metadata && typeof metadata.source === "string" ? metadata.source : null;
  }

  let planFileCount = 0;
  let totalSizeBytes = 0;

  if (planSetCount > 0) {
    const { count: planFilesCount, error: planFilesCountError } = await context.supabase
      .from("plan_files" as never)
      .select("id, plan_sets!inner(project_id)" as never, { count: "exact", head: true })
      .eq("tenant_id" as never, context.tenantId as never)
      .eq("plan_sets.project_id" as never, project.id as never)
      .limit(1);

    if (planFilesCountError) {
      throw mapSupabaseError(
        planFilesCountError,
        "Impossible de compter les fichiers de plans."
      );
    }

    planFileCount = planFilesCount ?? 0;

    let offset = 0;
    while (offset < planFileCount) {
      const end = offset + PLAN_FILE_SUM_BATCH_SIZE - 1;
      const { data: planFilesData, error: planFilesError } = await context.supabase
        .from("plan_files" as never)
        .select("file_size_bytes, plan_sets!inner(project_id)" as never)
        .eq("tenant_id" as never, context.tenantId as never)
        .eq("plan_sets.project_id" as never, project.id as never)
        .order("id" as never, { ascending: true })
        .range(offset, end);

      if (planFilesError) {
        throw mapSupabaseError(planFilesError, "Impossible de charger les fichiers de plans.");
      }

      const rows = (planFilesData ?? []) as Array<{
        file_size_bytes: number | string | null;
      }>;

      if (rows.length === 0) {
        break;
      }

      totalSizeBytes += rows.reduce(
        (total, row) => total + toSafeInteger(row.file_size_bytes),
        0
      );
      offset += rows.length;
    }
  }

  const latestJobRow = (latestJobResult.data ?? null) as {
    id: string;
    status: string;
    level: string;
    processing_strategy: string | null;
    provider_batch_state: string | null;
    source_file_name: string | null;
    created_at: string;
    error_code: string | null;
    error_message: string | null;
    estimate_version_id: string;
    plan_set_id: string | null;
  } | null;

  let latestJob: AffaireHubPlansSummaryResult["latestJob"] = null;
  let coveragePercent: number | null = null;
  let exceptionCount: number | null = null;
  let failureReasonLabel: string | null = null;
  let launchRecommendation: TakeoffDocumentRecommendation | null = null;
  let defaultPlanSetFileCount = 0;
  let defaultPlanSetUpdatedAt: string | null = null;
  let defaultPlanSetLatestJob: AffaireHubPlansSummaryResult["defaultPlanSetLatestJob"] =
    null;

  if (defaultPlanSetId) {
    const [defaultPlanFilesResult, defaultPlanSetLatestJobResult] =
      await Promise.all([
        context.supabase
          .from("plan_files" as never)
          .select("file_name, file_type, page_count, created_at" as never)
          .eq("tenant_id" as never, context.tenantId as never)
          .eq("plan_set_id" as never, defaultPlanSetId as never)
          .order("created_at" as never, { ascending: true }),
        context.supabase
          .from("takeoff_jobs" as never)
          .select(
            "status, created_at, estimate_version_id, plan_set_id" as never,
          )
          .eq("tenant_id" as never, context.tenantId as never)
          .eq("plan_set_id" as never, defaultPlanSetId as never)
          .order("created_at" as never, { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const { data: defaultPlanFilesData, error: defaultPlanFilesError } =
      defaultPlanFilesResult;

    if (defaultPlanFilesError) {
      throw mapSupabaseError(
        defaultPlanFilesError,
        "Impossible de charger les fichiers du jeu de plans recommande."
      );
    }

    if (defaultPlanSetLatestJobResult.error) {
      throw mapSupabaseError(
        defaultPlanSetLatestJobResult.error,
        "Impossible de charger le dernier job du jeu de plans recommande.",
      );
    }

    const defaultPlanFiles = (defaultPlanFilesData ?? []) as Array<{
      file_name?: string | null;
      file_type?: string | null;
      page_count?: number | null;
      created_at?: string | null;
    }>;
    defaultPlanSetFileCount = defaultPlanFiles.length;
    defaultPlanSetUpdatedAt = defaultPlanFiles.reduce<string | null>(
      (latest, file) => {
        const createdAt = file.created_at ?? null;
        if (!createdAt) {
          return latest;
        }
        if (!latest || createdAt.localeCompare(latest) > 0) {
          return createdAt;
        }
        return latest;
      },
      null,
    );
    const defaultPlanSetLatestJobRow =
      (defaultPlanSetLatestJobResult.data ?? null) as {
        status: string;
        created_at: string;
        estimate_version_id: string | null;
        plan_set_id: string | null;
      } | null;
    if (defaultPlanSetLatestJobRow) {
      defaultPlanSetLatestJob = {
        status: defaultPlanSetLatestJobRow.status,
        planSetId: defaultPlanSetLatestJobRow.plan_set_id,
        estimateVersionId: defaultPlanSetLatestJobRow.estimate_version_id,
        createdAt: defaultPlanSetLatestJobRow.created_at,
      };
    }

    launchRecommendation = classifyTakeoffPlanSetSource({
      files: defaultPlanFiles.map((file) => ({
        file_name: file.file_name ?? "plan.pdf",
        file_type: file.file_type ?? "application/pdf",
        page_count:
          typeof file.page_count === "number" ? file.page_count : null,
      })),
    });
  }

  if (latestJobRow) {
    const isCompletedOrApplied =
      latestJobRow.status === "completed" || latestJobRow.status === "applied";
    const reviewVersionId = await resolveTakeoffReviewVersionId({
      context,
      projectId: project.id,
      sourceVersionId: latestJobRow.estimate_version_id,
      jobId: latestJobRow.id,
      currentVersionId,
    });

    if (isCompletedOrApplied) {
      try {
        const summary = await fetchTakeoffDpgfSummaryForHub({
          supabase: context.supabase,
          tenantId: context.tenantId,
          jobId: latestJobRow.id,
          versionId: reviewVersionId,
          projectId: project.id,
        });

        coveragePercent =
          summary.total_lines > 0
            ? Math.round(
                ((summary.total_lines - summary.lines_without_proof) /
                  summary.total_lines) *
                  100
              )
            : 0;
        exceptionCount =
          summary.to_confirm +
          summary.significant_gaps +
          summary.forced_manual +
          summary.unused_takeoff_items;
      } catch {
        // Leave coveragePercent/exceptionCount as null — UI will show degraded state
      }
    }

    if (latestJobRow.status === "failed" || latestJobRow.status === "canceled") {
      failureReasonLabel = getTakeoffFailureReasonLabel({
        errorCode: latestJobRow.error_code,
        fallbackMessage: latestJobRow.error_message,
      });
    }

    const mapped = resolveTakeoffVisibleJobStatus({
      status: latestJobRow.status,
      processingStrategy:
        latestJobRow.processing_strategy === "sync" ||
        latestJobRow.processing_strategy === "batch"
          ? latestJobRow.processing_strategy
          : null,
      providerBatchState:
        latestJobRow.provider_batch_state === "submitted" ||
        latestJobRow.provider_batch_state === "pending" ||
        latestJobRow.provider_batch_state === "running" ||
        latestJobRow.provider_batch_state === "succeeded" ||
        latestJobRow.provider_batch_state === "failed" ||
        latestJobRow.provider_batch_state === "cancelled" ||
        latestJobRow.provider_batch_state === "expired" ||
        latestJobRow.provider_batch_state === "unknown"
          ? latestJobRow.provider_batch_state
          : null,
      exceptionCount,
      compareSummaryUnavailable:
        isCompletedOrApplied &&
        (coveragePercent === null || exceptionCount === null),
    });
    latestJob = {
      jobId: latestJobRow.id,
      status: mapped.status,
      label: mapped.label,
      reviewVersionId,
      planSetId: latestJobRow.plan_set_id ?? null,
      estimateVersionId: latestJobRow.estimate_version_id,
      createdAt: latestJobRow.created_at,
    };
  }

  const registerSummary = await fetchAffaireRegisterGateSummary({
    supabase: context.supabase as never,
    projectId: project.id,
    versionId: currentVersionId,
  });

  return {
    planSetCount,
    planFileCount,
    totalSizeBytes,
    hasLegacyFallback,
    defaultPlanSetId,
    defaultPlanSetName,
    defaultPlanSetSource,
    defaultPlanSetFileCount,
    defaultPlanSetUpdatedAt,
    ...(launchRecommendation ? { launchRecommendation } : {}),
    ...(defaultPlanSetLatestJob ? { defaultPlanSetLatestJob } : {}),
    latestJob,
    coveragePercent,
    exceptionCount,
    openQuestionsCount: registerSummary.openQuestionsCount,
    failureReasonLabel,
  };
}

async function fetchAffaireListWithContext(
  context: AffaireContext,
  query: NormalizedAffaireListQuery
): Promise<AffaireListPageResult> {
  const decodedCursor = query.cursor ? decodeAffaireCursor(query.cursor) : null;
  const fetchLimit = query.size + 1;

  const { data, error } = await context.supabase.rpc("list_affaires_page", {
    p_tenant_id: context.tenantId,
    p_owner_user_id: getOwnerScopeUserId(context),
    p_limit: fetchLimit,
    p_search: query.q,
    p_statuses: query.status,
    p_favorites_only: query.favoritesOnly,
    p_cursor_updated_at: decodedCursor?.updatedAt ?? null,
    p_cursor_project_id: decodedCursor?.projectId ?? null,
    p_sort_dir: query.dir,
  } as never);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger la liste des affaires.");
  }

  const rows = (data ?? []) as ListAffairesPageRow[];
  const hasNextPage = rows.length > query.size;
  const pageRows = hasNextPage ? rows.slice(0, query.size) : rows;
  const items = pageRows.map(toAffaireListItem);

  const lastItem = items[items.length - 1] ?? null;
  const nextCursor = hasNextPage && lastItem
    ? encodeAffaireCursor({
        updatedAt: lastItem.currentUpdatedAt,
        projectId: lastItem.projectId,
      })
    : null;

  return {
    items,
    pageSize: query.size,
    nextCursor,
    hasNextPage,
  };
}

const MANAGER_QUEUE_BATCH_SIZE = 10;
const MANAGER_QUEUE_LIST_PAGE_SIZE: AffairePageSize = 100;

async function fetchAllAffaireListItemsWithContext(
  context: AffaireContext,
  query: NormalizedAffaireListQuery
): Promise<AffaireListItem[]> {
  const items: AffaireListItem[] = [];
  let cursor: string | null = null;

  while (true) {
    const page = await fetchAffaireListWithContext(context, {
      ...query,
      manager: "all",
      size: MANAGER_QUEUE_LIST_PAGE_SIZE,
      cursor,
    });
    items.push(...page.items);

    if (!page.hasNextPage || !page.nextCursor) {
      return items;
    }

    cursor = page.nextCursor;
  }
}

async function fetchAffaireManagerReadinessWithContext(
  context: AffaireContext,
  item: AffaireListItem
): Promise<AffaireHubReadinessResult | null> {
  const projectRow = {
    id: item.projectId,
    tenant_id: context.tenantId,
    user_id: getOwnerScopeUserId(context) ?? context.userId,
    name: item.projectName,
    reference: item.projectReference,
    client_name: item.projectClient,
    is_archived: false,
  } satisfies AffaireHubProjectRow;

  if (item.currentVersionId) {
    const [{ count, error }, intakeResult, registerGateSummaryResult] = await Promise.all([
      context.supabase
        .from("estimate_items")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", context.tenantId)
        .eq("version_id", item.currentVersionId)
        .eq("item_type", "line")
        .limit(1),
      Promise.resolve(fetchAffaireIntakeWorkspace(projectRow.id)).catch(() => null),
      Promise.resolve(
        fetchAffaireRegisterGateSummary({
          supabase: context.supabase as never,
          projectId: projectRow.id,
          versionId: item.currentVersionId,
        })
      ).catch(() => null),
    ]);

    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de qualifier la readiness manager de l'affaire."
      );
    }

    if (!intakeResult || !registerGateSummaryResult) {
      throw new Error("MANAGER_QUEUE_SIGNAL_UNAVAILABLE");
    }

    return buildAffaireHubReadinessSnapshot({
      lineCount: count ?? 0,
      briefStatus: intakeResult.briefDraft?.status ?? null,
      intakeReadiness: intakeResult.readiness
        ? {
            reviewDocumentsCount: intakeResult.readiness.reviewDocumentsCount,
            confirmedMissingPiecesCount:
              intakeResult.readiness.confirmedMissingPiecesCount,
            confirmedCriticalMissingPiecesCount:
              intakeResult.readiness.confirmedCriticalMissingPiecesCount,
          }
        : null,
      registerGateSummary: registerGateSummaryResult,
    });
  }

  const [intakeResult, registerGateSummaryResult] = await Promise.all([
    Promise.resolve(fetchAffaireIntakeWorkspace(projectRow.id)).catch(() => null),
    Promise.resolve(
      fetchAffaireRegisterGateSummary({
        supabase: context.supabase as never,
        projectId: projectRow.id,
        versionId: null,
      })
    ).catch(() => null),
  ]);

  if (!intakeResult || !registerGateSummaryResult) {
    throw new Error("MANAGER_QUEUE_SIGNAL_UNAVAILABLE");
  }

  return buildAffaireHubReadinessSnapshot({
    lineCount: 0,
    briefStatus: intakeResult.briefDraft?.status ?? null,
    intakeReadiness: intakeResult.readiness
      ? {
          reviewDocumentsCount: intakeResult.readiness.reviewDocumentsCount,
          confirmedMissingPiecesCount:
            intakeResult.readiness.confirmedMissingPiecesCount,
          confirmedCriticalMissingPiecesCount:
            intakeResult.readiness.confirmedCriticalMissingPiecesCount,
        }
      : null,
    registerGateSummary: registerGateSummaryResult,
  });
}

async function classifyAffaireManagerQueueWithContext(
  context: AffaireContext,
  items: AffaireListItem[]
): Promise<{
  readinessByProjectId: Map<string, AffaireHubReadinessResult | null>;
  incompleteCount: number;
}> {
  const readinessByProjectId = new Map<string, AffaireHubReadinessResult | null>();
  let incompleteCount = 0;

  for (let startIndex = 0; startIndex < items.length; startIndex += MANAGER_QUEUE_BATCH_SIZE) {
    const batch = items.slice(startIndex, startIndex + MANAGER_QUEUE_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (item) => ({
        projectId: item.projectId,
        readiness: await fetchAffaireManagerReadinessWithContext(context, item),
      }))
    );

    settled.forEach((result) => {
      if (result.status === "fulfilled") {
        readinessByProjectId.set(result.value.projectId, result.value.readiness);
        return;
      }

      incompleteCount += 1;
    });
  }

  return {
    readinessByProjectId,
    incompleteCount,
  };
}

async function buildAffaireManagerQueueSummaryWithContext(
  context: AffaireContext,
  query: NormalizedAffaireListQuery
): Promise<{
  items: AffaireListItem[];
  summary: AffaireManagerQueueSummary;
  readinessByProjectId: Map<string, AffaireHubReadinessResult | null>;
}> {
  const items = await fetchAllAffaireListItemsWithContext(context, query);
  const { readinessByProjectId, incompleteCount } =
    await classifyAffaireManagerQueueWithContext(context, items);

  return {
    items,
    summary: {
      counts: buildManagerQueueCounts(readinessByProjectId),
      incompleteCount,
    },
    readinessByProjectId,
  };
}

async function fetchAffaireCountersWithContext(
  context: AffaireContext,
  query: Pick<NormalizedAffaireListQuery, "q" | "status" | "favoritesOnly">
): Promise<AffaireCountersResult> {
  const { data, error } = await context.supabase.rpc("get_affaires_counters", {
    p_tenant_id: context.tenantId,
    p_owner_user_id: getOwnerScopeUserId(context),
    p_search: query.q,
    p_statuses: query.status,
    p_favorites_only: query.favoritesOnly,
  } as never);

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les compteurs affaires.");
  }

  const row = ((data ?? [])[0] as AffaireCountersRow | undefined) ?? {
    total_count: 0,
    filtered_count: 0,
    draft_count: 0,
    sent_count: 0,
    accepted_count: 0,
    archived_count: 0,
  };

  return {
    totalCount: toSafeInteger(row.total_count),
    filteredCount: toSafeInteger(row.filtered_count),
    statusCounts: {
      draft: toSafeInteger(row.draft_count),
      sent: toSafeInteger(row.sent_count),
      accepted: toSafeInteger(row.accepted_count),
      archived: toSafeInteger(row.archived_count),
    },
  };
}

async function fetchAffaireManagerFilteredPageDataWithContext(
  context: AffaireContext,
  query: NormalizedAffaireListQuery
): Promise<AffairePageDataResult> {
  const baseQuery = {
    ...query,
    manager: "all" as const,
    cursor: null,
  };

  const [baseCounters, managerQueueData] = await Promise.all([
    fetchAffaireCountersWithContext(context, baseQuery),
    buildAffaireManagerQueueSummaryWithContext(context, baseQuery),
  ]);

  if (managerQueueData.summary.incompleteCount > 0) {
    throw new Error("MANAGER_QUEUE_CLASSIFICATION_INCOMPLETE");
  }

  const filteredItems = managerQueueData.items.filter((item) =>
    matchesManagerQueueFilter(
      managerQueueData.readinessByProjectId.get(item.projectId) ?? null,
      query.manager
    )
  );

  return {
    list: paginateAffaireItems(filteredItems, query),
    counters: {
      totalCount: baseCounters.totalCount,
      filteredCount: filteredItems.length,
      statusCounts: buildStatusCounts(filteredItems),
    },
    managerQueue: managerQueueData.summary,
  };
}

export async function fetchAffaireList(
  input: AffaireListQuery = {}
): Promise<AffaireListPageResult> {
  const context = await getAuthenticatedContext();
  const query = normalizeAffaireListQuery(input);
  if (query.manager !== "all") {
    return (await fetchAffaireManagerFilteredPageDataWithContext(context, query)).list;
  }
  return fetchAffaireListWithContext(context, query);
}

export async function fetchAffaireCounters(
  input: Pick<AffaireListQuery, "q" | "status" | "favorites" | "manager"> = {}
): Promise<AffaireCountersResult> {
  const context = await getAuthenticatedContext();
  const query = normalizeAffaireListQuery(input);
  if (query.manager !== "all") {
    return (await fetchAffaireManagerFilteredPageDataWithContext(context, query)).counters;
  }
  return fetchAffaireCountersWithContext(context, query);
}

export async function fetchAffaireManagerQueueSummary(
  input: Pick<AffaireListQuery, "q" | "status" | "favorites"> = {}
): Promise<AffaireManagerQueueSummary> {
  const context = await getAuthenticatedContext();
  const query = normalizeAffaireListQuery(input);
  const result = await buildAffaireManagerQueueSummaryWithContext(context, {
    ...query,
    manager: "all",
    cursor: null,
  });
  return result.summary;
}

export async function fetchAffairePageData(
  input: AffaireListQuery = {}
): Promise<AffairePageDataResult> {
  const context = await getAuthenticatedContext();
  const query = normalizeAffaireListQuery(input);

  if (query.manager !== "all") {
    return fetchAffaireManagerFilteredPageDataWithContext(context, query);
  }

  const [list, counters] = await Promise.all([
    fetchAffaireListWithContext(context, query),
    fetchAffaireCountersWithContext(context, query),
  ]);

  return {
    list,
    counters,
    managerQueue: null,
  };
}

export const fetchAffaireProjectBasic = cache(
  async (projectId: string): Promise<AffaireHubProject> => {
    const context = await getAuthenticatedContext();
    const row = await fetchAffaireHubProjectOrThrow(context, projectId);
    return {
      id: row.id,
      name: row.name,
      reference: row.reference,
      clientName: row.client_name,
    };
  }
);

export async function fetchAffaireHubSummary(
  projectId: string
): Promise<AffaireHubSummaryResult> {
  const context = await getAuthenticatedContext();
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);
  return fetchAffaireHubSummaryWithContext(context, project);
}

export async function fetchAffaireHubTimeline(
  projectId: string,
  page?: number
): Promise<AffaireHubTimelineResult> {
  const context = await getAuthenticatedContext();
  const safePage = normalizeHubTimelinePage(page);
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);

  return listEstimateProjectVersions({
    projectId: project.id,
    page: safePage,
  });
}

export async function fetchAffaireHubDpgfSource(
  projectId: string
): Promise<AffaireHubDpgfSourceResult> {
  const context = await getAuthenticatedContext();
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);
  return fetchAffaireHubDpgfSourceWithContext(context, project);
}

export const fetchAffaireHubPlansSummary = cache(
  async (projectId: string): Promise<AffaireHubPlansSummaryResult> => {
    const context = await getAuthenticatedContext();
    const project = await fetchAffaireHubProjectOrThrow(context, projectId);
    return fetchAffaireHubPlansSummaryWithContext(context, project);
  }
);

export async function fetchAffaireHubPageData(
  projectId: string,
  page?: number
): Promise<AffaireHubPageDataResult> {
  const context = await getAuthenticatedContext();
  const safePage = normalizeHubTimelinePage(page);
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);

  const [summary, timeline, dpgfSource] = await Promise.all([
    fetchAffaireHubSummaryWithContext(context, project),
    listEstimateProjectVersions({
      projectId: project.id,
      page: safePage,
    }),
    fetchAffaireHubDpgfSourceWithContext(context, project),
  ]);

  return {
    summary,
    timeline,
    dpgfSource,
  };
}

const SUPPLIER_COMPARISON_BATCH_SIZE = 200;

async function computeAffaireOrderReadiness(versionId: string) {
  const estimateItemsResult = await listEstimateItems(versionId);
  const orderableLineIds = estimateItemsResult.items
    .filter(
      (item) =>
        item.item_type === "line" &&
        (item.supply_type_id !== null || item.selected_supplier_price_id !== null)
    )
    .map((item) => item.id);

  if (orderableLineIds.length === 0) {
    return {
      status: "waiting" as const,
      orderableLinesCount: 0,
      coveredLinesCount: 0,
      ambiguousLinesCount: 0,
      missingPriceLinesCount: 0,
      staleLinesCount: 0,
      errorMessage: null,
    };
  }

  let coveredLinesCount = 0;
  let ambiguousLinesCount = 0;
  let missingPriceLinesCount = 0;
  let staleLinesCount = 0;

  for (
    let startIndex = 0;
    startIndex < orderableLineIds.length;
    startIndex += SUPPLIER_COMPARISON_BATCH_SIZE
  ) {
    const batchItemIds = orderableLineIds.slice(
      startIndex,
      startIndex + SUPPLIER_COMPARISON_BATCH_SIZE
    );
    const batch = await getEstimateSupplierComparisons(versionId, batchItemIds);
    coveredLinesCount += batch.coverage_summary.covered_items;
    ambiguousLinesCount += batch.coverage_summary.ambiguous_items;
    missingPriceLinesCount += batch.coverage_summary.no_price_items;
    staleLinesCount += batch.coverage_summary.stale_items;
  }

  const hasOrderBlockers =
    ambiguousLinesCount > 0 || missingPriceLinesCount > 0 || staleLinesCount > 0;

  return {
    status: hasOrderBlockers ? ("blocked" as const) : ("ready" as const),
    orderableLinesCount: orderableLineIds.length,
    coveredLinesCount,
    ambiguousLinesCount,
    missingPriceLinesCount,
    staleLinesCount,
    errorMessage: null,
  };
}

export const fetchAffaireHubFinishLineSummary = cache(
  async (versionId: string): Promise<AffaireHubFinishLineSummaryResult> => {
    const [sendResult, orderResult] = await Promise.allSettled([
      getEstimateSendGating(versionId),
      computeAffaireOrderReadiness(versionId),
    ]);

    const readyToSend =
      sendResult.status === "fulfilled"
        ? {
            status:
              sendResult.value.gating.blockingFlags.length > 0
                ? ("blocked" as const)
                : sendResult.value.gating.warningFlags.length > 0
                  ? ("warning" as const)
                  : ("ready" as const),
            blockingFlags: sendResult.value.gating.blockingFlags,
            warningFlags: sendResult.value.gating.warningFlags,
            checkedAt: sendResult.value.gating.checkedAt,
            stalePriceDays: sendResult.value.gating.stalePriceDays,
            errorMessage: null,
          }
        : {
            status: "unavailable" as const,
            blockingFlags: [],
            warningFlags: [],
            checkedAt: null,
            stalePriceDays: null,
            errorMessage: "Impossible de verifier la sortie devis pour le moment.",
          };

    const readyToOrder =
      orderResult.status === "fulfilled"
        ? orderResult.value
        : {
            status: "unavailable" as const,
            orderableLinesCount: 0,
            coveredLinesCount: 0,
            ambiguousLinesCount: 0,
            missingPriceLinesCount: 0,
            staleLinesCount: 0,
            errorMessage: "Impossible d'evaluer la preparation commandes pour le moment.",
          };

    const submissionReadiness = buildAffaireSubmissionReadinessSnapshot({
      blockingFlags: readyToSend.blockingFlags,
      warningFlags: readyToSend.warningFlags,
      checkedAt: readyToSend.checkedAt,
      stalePriceDays: readyToSend.stalePriceDays,
      errorMessage: readyToSend.errorMessage,
    });

    return {
      versionId,
      submissionReadiness,
      readyToSend,
      readyToOrder,
    };
  }
);

/* ------------------------------------------------------------------ */
/*  Margin Analysis                                                     */
/* ------------------------------------------------------------------ */

type MarginAnalysisVersionRow = Pick<
  EstimateVersionRow,
  | "id"
  | "project_id"
  | "version_number"
  | "status"
  | "total_ht_cents"
  | "margin_multiplier"
  | "margin_mode"
  | "tax_rate_bp"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "updated_at"
>;

function hasLaborSplitPayload(
  item: Pick<
    EstimateItemRecord,
    | "h_mo_atelier"
    | "k_mo_atelier"
    | "labor_role_atelier_id"
    | "h_mo_chantier"
    | "k_mo_chantier"
    | "labor_role_chantier_id"
  >
) {
  return (
    (item.h_mo_atelier !== null && item.h_mo_atelier !== undefined) ||
    (item.labor_role_atelier_id !== null &&
      item.labor_role_atelier_id !== undefined) ||
    (item.h_mo_chantier !== null && item.h_mo_chantier !== undefined) ||
    (item.labor_role_chantier_id !== null &&
      item.labor_role_chantier_id !== undefined) ||
    ((item.k_mo_atelier ?? 1) !== 1) ||
    ((item.k_mo_chantier ?? 1) !== 1)
  );
}

async function fetchAffaireHubMarginAnalysisWithContext(
  context: AffaireContext,
  project: AffaireHubProjectRow
): Promise<AffaireHubMarginAnalysisResult> {
  // 1. Fetch all versions
  const { data: versionsData, error: versionsError } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, total_ht_cents, margin_multiplier, margin_mode, tax_rate_bp, discount_bp, discount_mode, discount_steps, global_coefficient, updated_at"
    )
    .eq("tenant_id", context.tenantId)
    .eq("project_id", project.id)
    .order("version_number", { ascending: true });

  if (versionsError) {
    throw mapSupabaseError(versionsError, "Impossible de charger les versions pour l'analyse de marge.");
  }

  const versions = (versionsData ?? []) as MarginAnalysisVersionRow[];
  if (versions.length === 0) return null;

  // 2. Current version = highest version_number
  const currentVersion = versions[versions.length - 1];

  // 3. Fetch all items for current version
  const { data: itemsData, error: itemsError } = await context.supabase
    .from("estimate_items")
    .select(
      "id, parent_id, item_type, position, title, description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, h_mo_atelier, k_mo_atelier, labor_role_atelier_id, h_mo_chantier, k_mo_chantier, labor_role_chantier_id, pu_ht_cents, labor_role_id, category_id, supply_type_id, line_total_ht_cents, line_tax_cents, line_total_ttc_cents"
    )
    .eq("tenant_id", context.tenantId)
    .eq("version_id", currentVersion.id);

  if (itemsError) {
    throw mapSupabaseError(itemsError, "Impossible de charger les lignes pour l'analyse de marge.");
  }

  const items = (itemsData ?? []) as EstimateItemRecord[];
  if (items.length === 0) return null;

  // 4. Fetch labor roles for rate lookup
  const laborRoleIds = new Set<string>();
  for (const item of items) {
    if (item.labor_role_id) laborRoleIds.add(item.labor_role_id);
    if (item.labor_role_atelier_id) laborRoleIds.add(item.labor_role_atelier_id);
    if (item.labor_role_chantier_id) laborRoleIds.add(item.labor_role_chantier_id);
  }

  const laborRateById = new Map<string, number>();
  if (laborRoleIds.size > 0) {
    const { data: rolesData, error: rolesError } = await context.supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .eq("tenant_id", context.tenantId)
      .in("id", [...laborRoleIds]);

    if (rolesError) {
      throw mapSupabaseError(rolesError, "Impossible de charger les roles main d'oeuvre.");
    }

    for (const role of rolesData ?? []) {
      laborRateById.set(role.id, role.hourly_rate_cents ?? 0);
    }
  }

  // 5. Identify root sections
  const rootSections = items.filter(
    (item) => item.item_type === "section" && item.parent_id === null
  );
  const rootSectionIds = rootSections.map((s) => s.id);

  if (rootSectionIds.length === 0) return null;

  const marginMultiplier = Number.isFinite(currentVersion.margin_multiplier)
    ? currentVersion.margin_multiplier
    : 1;
  const taxRateBp = currentVersion.tax_rate_bp ?? 0;
  const globalCoefficient = currentVersion.global_coefficient ?? 1;
  const discountCents = computeStoredDiscountCents(
    {
      margin_multiplier: marginMultiplier,
      tax_rate_bp: taxRateBp,
      discount_bp: currentVersion.discount_bp ?? 0,
      discount_mode: currentVersion.discount_mode ?? "simple",
      discount_steps: currentVersion.discount_steps ?? [],
      global_coefficient: globalCoefficient,
      total_ht_cents: currentVersion.total_ht_cents,
    },
    items
  );
  const isLaborSplitEnabled = items.some((item) =>
    item.item_type === "line" ? hasLaborSplitPayload(item) : false
  );

  // 6. Dual-pass calculation
  // Pass 1 — Costs (margin=1, no discount)
  const costTotals = computeAllSectionTotals({
    items,
    marginMultiplier: 1,
    taxRateBp: 0,
    discountCents: 0,
    laborRateById,
    isLaborSplitEnabled,
    sectionIds: rootSectionIds,
  });

  // Pass 2 — Sales (real margin, real discount)
  const saleTotals = computeAllSectionTotals({
    items,
    marginMultiplier: marginMultiplier * globalCoefficient,
    taxRateBp,
    discountCents,
    laborRateById,
    isLaborSplitEnabled,
    sectionIds: rootSectionIds,
  });

  // 7. Global totals
  let globalCostCents = 0;
  let globalSaleCents = 0;
  for (const sectionId of rootSectionIds) {
    const cost = costTotals.get(sectionId);
    const sale = saleTotals.get(sectionId);
    globalCostCents += cost?.totalHtCents ?? 0;
    globalSaleCents += sale?.totalHtCents ?? 0;
  }

  const globalMarginEurCents = globalSaleCents - globalCostCents;
  const globalMarginPercent =
    globalCostCents > 0 ? ((globalSaleCents - globalCostCents) / globalCostCents) * 100 : 0;

  // 8. Build sections array
  const sections: MarginSectionBreakdown[] = rootSections
    .sort((a, b) => a.position - b.position)
    .map((section) => {
      const cost = costTotals.get(section.id);
      const sale = saleTotals.get(section.id);
      const costCents = cost?.totalHtCents ?? 0;
      const saleCents = sale?.totalHtCents ?? 0;
      const marginEurCents = saleCents - costCents;
      const marginPercent =
        costCents > 0 ? ((saleCents - costCents) / costCents) * 100 : 0;

      return {
        sectionId: section.id,
        sectionTitle: section.title,
        sectionPosition: section.position,
        costCents,
        saleCents,
        marginPercent,
        marginEurCents,
      };
    });

  // 9. Build version evolution
  const versionEvolution: MarginVersionPoint[] = versions.map((v) => {
    const mm = Number.isFinite(v.margin_multiplier) ? v.margin_multiplier : 1;
    return {
      versionNumber: toSafeInteger(v.version_number),
      versionId: v.id,
      status: v.status,
      marginMultiplier: mm,
      marginPercent: (mm - 1) * 100,
      totalHtCents: toSafeInteger(v.total_ht_cents),
    };
  });

  return {
    global: {
      costCents: globalCostCents,
      saleCents: globalSaleCents,
      marginPercent: globalMarginPercent,
      marginEurCents: globalMarginEurCents,
      marginMultiplier,
    },
    sections,
    versionEvolution,
    currentVersionId: currentVersion.id,
  };
}

export const fetchProjectVersionList = cache(
  async (
    projectId: string
  ): Promise<Array<{ id: string; version_number: number }>> => {
    const context = await getAuthenticatedContext();
    const project = await fetchAffaireHubProjectOrThrow(context, projectId);
    const versions: Array<{ id: string; version_number: number }> = [];
    let offset = 0;

    while (true) {
      const end = offset + AFFAIRE_PROJECT_VERSIONS_BATCH_SIZE - 1;
      const { data, error } = await context.supabase
        .from("estimate_versions")
        .select("id, version_number")
        .eq("project_id", project.id)
        .eq("tenant_id", context.tenantId)
        .order("version_number", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, end);

      if (error) {
        throw mapSupabaseError(
          error,
          "Impossible de charger la liste des versions."
        );
      }

      const rows = (data ?? []) as Array<{ id: string; version_number: number }>;
      if (rows.length === 0) {
        break;
      }

      versions.push(...rows);
      offset += rows.length;
    }

    return versions;
  }
);

export async function fetchAffaireHubMarginAnalysis(
  projectId: string
): Promise<AffaireHubMarginAnalysisResult> {
  const context = await getAuthenticatedContext();
  const project = await fetchAffaireHubProjectOrThrow(context, projectId);
  return fetchAffaireHubMarginAnalysisWithContext(context, project);
}
