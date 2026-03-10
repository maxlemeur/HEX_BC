import type { PostgrestError } from "@supabase/supabase-js";
import { cache } from "react";

import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { forbidden } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { normalizeRiskAlertRow } from "@/lib/takeoff/risk-radar";
import type {
  TakeoffRiskAlert,
  TakeoffRiskStatus,
} from "@/lib/takeoff/types";
import type { Database } from "@/types/database";

import {
  buildDirectionSyntheticAlerts,
  type DirectionSyntheticAlert,
} from "./alerts";
import { writeDirectionDebugLog } from "./debug";
import type { DirectionDashboardQuery } from "./schemas";

type EstimateVersionApprovalStatus =
  Database["public"]["Enums"]["estimate_version_approval_status"];
type TenantRole = Database["public"]["Enums"]["tenant_role"];

type VersionRow = {
  id: string;
  project_id: string;
  version_number: number;
  status: string;
  approval_status: EstimateVersionApprovalStatus;
  total_ht_cents: number;
  margin_bp: number | null;
  discount_bp: number | null;
  updated_at: string;
  date_devis: string;
  validite_jours: number;
  estimate_projects:
    | {
        id: string;
        user_id: string;
        name: string;
        client_name: string | null;
        is_archived: boolean;
      }
    | Array<{
        id: string;
        user_id: string;
        name: string;
        client_name: string | null;
        is_archived: boolean;
      }>
    | null;
};

type ReviewCycleRow = {
  id: string;
  version_id: string;
  requested_at: string;
};

type ReviewerState =
  | "seen"
  | "review_laurent"
  | "blocking"
  | "acceptable";

type ReviewerStateRow = {
  cycle_id: string;
  state: ReviewerState;
};

type TakeoffJobRow = {
  id: string;
  estimate_version_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string;
};

export type DirectionOwnerOption = {
  userId: string;
  label: string;
  role: TenantRole;
};

export type DirectionPortfolioCard = {
  projectId: string;
  versionId: string;
  projectName: string;
  clientName: string | null;
  ownerUserId: string;
  ownerName: string | null;
  amountHtCents: number;
  marginBp: number | null;
  riskScore: number;
  coveragePercent: number | null;
  openHypothesesCount: number;
  approvalStatus: EstimateVersionApprovalStatus;
  sendTargetAt: string | null;
  exceptionCount: number;
  latestJobId: string | null;
  cycleId: string | null;
  reviewerState: ReviewerState | null;
  lotLabels: string[];
  alerts: DirectionSyntheticAlert[];
};

export type DirectionWeeklyQueueState =
  | "sendable"
  | "ready_not_validated"
  | "blocked"
  | "high_risk";

export type DirectionWeeklyQueueItem = DirectionPortfolioCard & {
  priorityScore: number;
  queueState: DirectionWeeklyQueueState;
};

export type DirectionDashboardSummary = {
  totalAffaires: number;
  criticalCount: number;
  weeklyCount: number;
  validationPendingCount: number;
};

export type DirectionDashboardPagination = {
  page: number;
  pageSize: number;
  totalCards: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type DirectionDashboardPageData = {
  summary: DirectionDashboardSummary;
  cards: DirectionPortfolioCard[];
  weeklyQueue: DirectionWeeklyQueueItem[];
  alerts: DirectionSyntheticAlert[];
  ownerOptions: DirectionOwnerOption[];
  lotOptions: string[];
  pagination: DirectionDashboardPagination;
};

type ProjectAlertSignals = {
  latestJobId: string | null;
  alerts: DirectionSyntheticAlert[];
};

type DirectionPlansMetrics = {
  coveragePercent: number | null;
  exceptionCount: number | null;
  openHypothesesCount: number;
};

type EmbeddedProject = {
  id: string;
  user_id: string;
  name: string;
  client_name: string | null;
  is_archived: boolean;
};

const DIRECTION_PORTFOLIO_PAGE_SIZE = 24;
const DIRECTION_BATCH_SIZE = 100;

function toJsonValue<T>(value: T, fallback: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return fallback;
  }
}

function getSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Erreur direction inconnue.";
}

function chunkItems<T>(items: readonly T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function cloneDirectionSyntheticAlert(
  alert: DirectionSyntheticAlert
): DirectionSyntheticAlert {
  return {
    ...alert,
    reasons: [...alert.reasons],
    alertIds: [...alert.alertIds],
    lotLabels: [...alert.lotLabels],
  };
}

function cloneDirectionPortfolioCard(
  card: DirectionPortfolioCard
): DirectionPortfolioCard {
  return {
    ...card,
    lotLabels: [...card.lotLabels],
    alerts: card.alerts.map(cloneDirectionSyntheticAlert),
  };
}

function cloneDirectionWeeklyQueueItem(
  item: DirectionWeeklyQueueItem
): DirectionWeeklyQueueItem {
  return {
    ...item,
    lotLabels: [...item.lotLabels],
    alerts: item.alerts.map(cloneDirectionSyntheticAlert),
  };
}

function resolveEmbeddedProject(value: VersionRow["estimate_projects"]): EmbeddedProject | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function assertDirectionAccess(role: TenantRole) {
  if (role === "admin" || role === "director") {
    return;
  }

  throw forbidden(
    "Acces reserve a la direction et aux administrateurs.",
    undefined,
    "FORBIDDEN"
  );
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const nextValues: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLocaleLowerCase("fr-FR");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextValues.push(trimmed);
  }

  return nextValues;
}

function deriveSendTargetAt(
  deadlineAt: string | null,
  updatedAt: string
): string | null {
  if (deadlineAt) {
    return deadlineAt;
  }

  const updated = new Date(updatedAt);
  if (!Number.isFinite(updated.getTime())) {
    return null;
  }

  updated.setDate(updated.getDate() + 7);
  return updated.toISOString();
}

function deriveDeadlineFromWorkspace(
  workspace: Awaited<ReturnType<typeof fetchAffaireIntakeWorkspace>> | null
) {
  if (!workspace) {
    return null;
  }

  const deadlines = workspace.documents
    .map((document) => document.extractedMetadata.deadlineAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right));

  return deadlines[0] ?? null;
}

function scoreWeeklyPriority(item: DirectionPortfolioCard) {
  let score = item.riskScore;

  if (item.sendTargetAt) {
    const diffMs = new Date(item.sendTargetAt).getTime() - Date.now();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);

    if (diffDays <= 7) {
      score += 40;
    } else if (diffDays <= 30) {
      score += 20;
    }
  }

  if (item.amountHtCents >= 2_500_000) {
    score += 20;
  } else if (item.amountHtCents >= 1_000_000) {
    score += 10;
  }

  if (item.approvalStatus === "required" || item.approvalStatus === "in_review") {
    score += 15;
  }

  if (item.approvalStatus === "changes_requested") {
    score += 25;
  }

  if (item.reviewerState === "blocking") {
    score += 20;
  }

  return score;
}

function deriveWeeklyQueueState(
  item: DirectionPortfolioCard
): DirectionWeeklyQueueState {
  if (
    item.riskScore >= 70 ||
    item.alerts.some((alert) => alert.level === "critical")
  ) {
    return "high_risk";
  }

  if (
    item.approvalStatus === "changes_requested" ||
    item.coveragePercent === null ||
    item.coveragePercent < 65 ||
    item.openHypothesesCount > 0
  ) {
    return "blocked";
  }

  if (item.approvalStatus === "required" || item.approvalStatus === "in_review") {
    return "ready_not_validated";
  }

  return "sendable";
}

function isWithinHorizon(
  sendTargetAt: string | null,
  horizon: DirectionDashboardQuery["horizon"]
) {
  if (horizon === "all") {
    return true;
  }

  if (!sendTargetAt) {
    return false;
  }

  const diffMs = new Date(sendTargetAt).getTime() - Date.now();
  const diffDays = diffMs / (24 * 60 * 60 * 1000);

  if (horizon === "this_week") {
    return diffDays <= 7;
  }

  return diffDays <= 31;
}

function matchesLot(item: DirectionPortfolioCard, lot: string | null) {
  if (!lot) {
    return true;
  }

  return item.lotLabels.some(
    (label) => label.toLocaleLowerCase("fr-FR") === lot.toLocaleLowerCase("fr-FR")
  );
}

function resolveAlertJobId(alert: TakeoffRiskAlert) {
  if (typeof alert.takeoff_job_id === "string") {
    return alert.takeoff_job_id;
  }

  const metadata =
    typeof alert.metadata === "object" && alert.metadata !== null
      ? (alert.metadata as Record<string, unknown>)
      : {};

  return (
    (typeof metadata.takeoff_job_id === "string"
      ? metadata.takeoff_job_id
      : null) ??
    (typeof metadata.takeoffJobId === "string"
      ? metadata.takeoffJobId
      : null)
  );
}

function filterAlertsForLatestJob(
  alerts: TakeoffRiskAlert[],
  latestJobId: string | null
) {
  if (latestJobId === null) {
    return alerts;
  }

  return alerts.filter((alert) => {
    const alertJobId = resolveAlertJobId(alert);
    return alertJobId === null || alertJobId === latestJobId;
  });
}

const listDirectionOwnerOptions = cache(async function listDirectionOwnerOptions() {
  const { supabase, tenantId } = await getAuthenticatedContext();

  const { data: memberships, error: membershipsError } = await supabase
    .from("tenant_memberships")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .in("role", ["admin", "director", "engineer"]);

  if (membershipsError) {
    throw mapSupabaseError(
      membershipsError,
      "Impossible de charger les responsables disponibles."
    );
  }

  const membershipRows = (memberships ?? []) as Array<{
    user_id: string;
    role: TenantRole;
  }>;
  const userIds = membershipRows.map((row) => row.user_id);

  if (userIds.length === 0) {
    return [] as DirectionOwnerOption[];
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);

  if (profilesError) {
    throw mapSupabaseError(
      profilesError,
      "Impossible de charger les profils responsables."
    );
  }

  const profileById = new Map(
    ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
  );

  return membershipRows
    .map((membership) => ({
      userId: membership.user_id,
      label:
        profileById.get(membership.user_id)?.full_name ?? "Responsable inconnu",
      role: membership.role,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "fr-FR"));
});

const listLatestDirectionVersions = cache(async function listLatestDirectionVersions() {
  const context = await getAuthenticatedContext();
  assertDirectionAccess(context.tenantRole);

  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, approval_status, total_ht_cents, margin_bp, discount_bp, updated_at, date_devis, validite_jours, estimate_projects!inner(id, user_id, name, client_name, is_archived)"
    )
    .eq("tenant_id", context.tenantId)
    .neq("status", "archived")
    .eq("estimate_projects.is_archived", false)
    .order("project_id", { ascending: true })
    .order("version_number", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le portefeuille direction.");
  }

  const rows = (data ?? []) as VersionRow[];
  const versions = new Map<string, VersionRow>();

  for (const row of rows) {
    if (!versions.has(row.project_id)) {
      versions.set(row.project_id, row);
    }
  }

  return [...versions.values()];
});

const getDirectionVersionById = cache(async function getDirectionVersionById(
  projectId: string,
  versionId: string
) {
  const context = await getAuthenticatedContext();
  assertDirectionAccess(context.tenantRole);

  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select(
      "id, project_id, version_number, status, approval_status, total_ht_cents, margin_bp, discount_bp, updated_at, date_devis, validite_jours, estimate_projects!inner(id, user_id, name, client_name, is_archived)"
    )
    .eq("tenant_id", context.tenantId)
    .eq("id", versionId)
    .eq("project_id", projectId)
    .neq("status", "archived")
    .eq("estimate_projects.is_archived", false)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger la version de portefeuille direction."
    );
  }

  return (data ?? null) as VersionRow | null;
});

async function listReviewCyclesByVersionId(versionIds: string[]) {
  if (versionIds.length === 0) {
    return {
      cyclesByVersionId: new Map<string, ReviewCycleRow>(),
      reviewerStateByCycleId: new Map<string, ReviewerState>(),
    };
  }

  const context = await getAuthenticatedContext();
  const cycleRows = (
    await Promise.all(
      chunkItems(versionIds, DIRECTION_BATCH_SIZE).map(async (batch) => {
        const { data: cycles, error: cyclesError } = await context.supabase
          .from("estimate_review_cycles" as never)
          .select("id, version_id, requested_at" as never)
          .is("decision" as never, null)
          .in("version_id" as never, batch as never);

        if (cyclesError) {
          throw mapSupabaseError(
            cyclesError,
            "Impossible de charger les cycles de revue ouverts."
          );
        }

        return (cycles ?? []) as ReviewCycleRow[];
      })
    )
  ).flat();
  const cyclesByVersionId = new Map<string, ReviewCycleRow>();
  for (const row of cycleRows) {
    const current = cyclesByVersionId.get(row.version_id);
    if (!current || current.requested_at < row.requested_at) {
      cyclesByVersionId.set(row.version_id, row);
    }
  }

  const cycleIds = [...cyclesByVersionId.values()].map((cycle) => cycle.id);
  const reviewerStateByCycleId = new Map<string, ReviewerState>();

  if (cycleIds.length > 0) {
    const reviewerStateRows = (
      await Promise.all(
        chunkItems(cycleIds, DIRECTION_BATCH_SIZE).map(async (batch) => {
          const { data: reviewerStates, error: reviewerStatesError } =
            await context.supabase
              .from("approval_queue_reviewer_states" as never)
              .select("cycle_id, state" as never)
              .eq("tenant_id" as never, context.tenantId as never)
              .eq("reviewer_id" as never, context.userId as never)
              .in("cycle_id" as never, batch as never);

          if (reviewerStatesError) {
            throw mapSupabaseError(
              reviewerStatesError,
              "Impossible de charger les etats de revue direction."
            );
          }

          return (reviewerStates ?? []) as ReviewerStateRow[];
        })
      )
    ).flat();

    for (const row of reviewerStateRows) {
      reviewerStateByCycleId.set(row.cycle_id, row.state);
    }
  }

  return {
    cyclesByVersionId,
    reviewerStateByCycleId,
  };
}

async function listLatestJobsByVersionId(versionIds: string[]) {
  if (versionIds.length === 0) {
    return new Map<string, TakeoffJobRow>();
  }

  const context = await getAuthenticatedContext();
  const jobRows = (
    await Promise.all(
      chunkItems(versionIds, DIRECTION_BATCH_SIZE).map(async (batch) => {
        const { data, error } = await context.supabase
          .from("takeoff_jobs" as never)
          .select("id, estimate_version_id, status, created_at, completed_at" as never)
          .in("estimate_version_id" as never, batch as never)
          .in("status" as never, ["completed", "applied"] as never)
          .order("estimate_version_id" as never, { ascending: true })
          .order("completed_at" as never, { ascending: false })
          .order("created_at" as never, { ascending: false });

        if (error) {
          throw mapSupabaseError(error, "Impossible de charger les derniers jobs metres.");
        }

        return (data ?? []) as TakeoffJobRow[];
      })
    )
  ).flat();
  const jobs = new Map<string, TakeoffJobRow>();
  for (const row of jobRows) {
    if (!jobs.has(row.estimate_version_id)) {
      jobs.set(row.estimate_version_id, row);
    }
  }

  return jobs;
}

async function listRiskAlertsByVersionId(versionIds: string[]) {
  if (versionIds.length === 0) {
    return new Map<string, TakeoffRiskAlert[]>();
  }

  const context = await getAuthenticatedContext();
  const alertRows = (
    await Promise.all(
      chunkItems(versionIds, DIRECTION_BATCH_SIZE).map(async (batch) => {
        const { data, error } = await context.supabase
          .from("estimate_risk_alerts" as never)
          .select(
            [
              "id",
              "created_at",
              "updated_at",
              "tenant_id",
              "project_id",
              "version_id",
              "takeoff_job_id",
              "scope_type",
              "scope_ref",
              "scope_id",
              "scope_label",
              "cause_code",
              "severity",
              "status",
              "risk_score",
              "margin_bucket",
              "line_id",
              "lot_id",
              "reason_labels",
              "provenance",
              "metadata",
              "review_note",
              "reviewed_at",
              "reviewed_by",
              "is_active",
              "first_detected_at",
              "last_detected_at",
            ].join(", ") as never
          )
          .eq("tenant_id" as never, context.tenantId as never)
          .eq("is_active" as never, true as never)
          .in("version_id" as never, batch as never);

        if (error) {
          throw mapSupabaseError(error, "Impossible de charger les alertes de risque.");
        }

        return (data ?? []) as Array<Record<string, unknown>>;
      })
    )
  ).flat();
  const alertsByVersionId = new Map<string, TakeoffRiskAlert[]>();

  for (const row of alertRows) {
    const normalized = normalizeRiskAlertRow(row);
    const versionId =
      typeof row.version_id === "string" ? row.version_id : null;
    if (!normalized) {
      continue;
    }
    if (!versionId) {
      continue;
    }

    const current = alertsByVersionId.get(versionId) ?? [];
    current.push(normalized);
    alertsByVersionId.set(versionId, current);
  }

  return alertsByVersionId;
}

async function listDirectionPlansMetricsByProjectId(
  context: Awaited<ReturnType<typeof getAuthenticatedContext>>,
  versions: VersionRow[],
  latestJobsByVersionId: Map<string, TakeoffJobRow>
) {
  const metricsByProjectId = new Map<string, DirectionPlansMetrics>(
    versions.map((version) => [
      version.project_id,
      {
        coveragePercent: null,
        exceptionCount: null,
        openHypothesesCount: 0,
      },
    ])
  );

  if (versions.length === 0) {
    return metricsByProjectId;
  }

  const versionIdByProjectId = new Map(
    versions.map((version) => [version.project_id, version.id])
  );
  const jobs = versions.flatMap((version) => {
    const latestJob = latestJobsByVersionId.get(version.id);
    if (!latestJob) {
      return [];
    }

    return [
      {
        jobId: latestJob.id,
        projectId: version.project_id,
        versionId: version.id,
      },
    ];
  });

  const registerRows = await Promise.all(
    chunkItems(versions, DIRECTION_BATCH_SIZE).map(async (batch) => {
      const projectIds = batch.map((version) => version.project_id);
      const versionIds = batch.map((version) => version.id);
      const { data, error } = await (context.supabase
        .from("affaire_register_entries" as never)
        .select("project_id, version_id, status" as never)
        .eq("tenant_id" as never, context.tenantId as never)
        .eq("is_active" as never, true as never)
        .in("project_id" as never, projectIds as never)
        .or(`version_id.is.null,version_id.in.(${versionIds.join(",")})`) as PromiseLike<{
        data: Array<{
          project_id: string;
          version_id: string | null;
          status: string;
        }> | null;
        error: PostgrestError | null;
      }>);

      if (error) {
        throw mapSupabaseError(
          error,
          "Impossible de charger la synthese batch du registre direction."
        );
      }

      return data ?? [];
    })
  );

  for (const row of registerRows.flat()) {
    const currentVersionId = versionIdByProjectId.get(row.project_id);
    if (!currentVersionId) {
      continue;
    }

    if (row.version_id !== null && row.version_id !== currentVersionId) {
      continue;
    }

    if (row.status !== "open" && row.status !== "clarify_with_client") {
      continue;
    }

    const current = metricsByProjectId.get(row.project_id);
    if (!current) {
      continue;
    }

    current.openHypothesesCount += 1;
  }

  if (jobs.length === 0) {
    return metricsByProjectId;
  }

  const jobIds = jobs.map((job) => job.jobId);
  const jobIdBatches = chunkItems(jobIds, DIRECTION_BATCH_SIZE);
  const versionIdBatches = chunkItems(
    [...new Set(jobs.map((job) => job.versionId))],
    DIRECTION_BATCH_SIZE
  );
  const versionIdByJobId = new Map(jobs.map((job) => [job.jobId, job.versionId]));

  const [linkRows, decisionRows, estimateItemRows] = await Promise.all([
    Promise.all(
      jobIdBatches.map(async (batch) => {
        const { data, error } = await context.supabase
          .from("takeoff_dpgf_links" as never)
          .select("takeoff_job_id" as never)
          .eq("tenant_id" as never, context.tenantId as never)
          .in("takeoff_job_id" as never, batch as never);

        if (error) {
          throw mapSupabaseError(
            error,
            "Impossible de charger la couverture DPGF direction."
          );
        }

        return (data ?? []) as Array<{ takeoff_job_id: string }>;
      })
    ),
    Promise.all(
      jobIdBatches.map(async (batch) => {
        const { data, error } = await context.supabase
          .from("takeoff_dpgf_review_decisions" as never)
          .select("takeoff_job_id" as never)
          .eq("tenant_id" as never, context.tenantId as never)
          .in("takeoff_job_id" as never, batch as never);

        if (error) {
          throw mapSupabaseError(
            error,
            "Impossible de charger les exceptions DPGF direction."
          );
        }

        return (data ?? []) as Array<{ takeoff_job_id: string }>;
      })
    ),
    Promise.all(
      versionIdBatches.map(async (batch) => {
        const { data, error } = await context.supabase
          .from("estimate_items" as never)
          .select("estimate_version_id" as never)
          .eq("tenant_id" as never, context.tenantId as never)
          .in("estimate_version_id" as never, batch as never);

        if (error) {
          throw mapSupabaseError(
            error,
            "Impossible de charger les lignes DPGF direction."
          );
        }

        return (data ?? []) as Array<{ estimate_version_id: string }>;
      })
    ),
  ]);

  const linkCountByJobId = new Map<string, number>();
  for (const row of linkRows.flat()) {
    linkCountByJobId.set(
      row.takeoff_job_id,
      (linkCountByJobId.get(row.takeoff_job_id) ?? 0) + 1
    );
  }

  const decisionCountByJobId = new Map<string, number>();
  for (const row of decisionRows.flat()) {
    decisionCountByJobId.set(
      row.takeoff_job_id,
      (decisionCountByJobId.get(row.takeoff_job_id) ?? 0) + 1
    );
  }

  const estimateItemCountByVersionId = new Map<string, number>();
  for (const row of estimateItemRows.flat()) {
    estimateItemCountByVersionId.set(
      row.estimate_version_id,
      (estimateItemCountByVersionId.get(row.estimate_version_id) ?? 0) + 1
    );
  }

  for (const { jobId, projectId } of jobs) {
    const current = metricsByProjectId.get(projectId);
    const versionId = versionIdByJobId.get(jobId);
    if (!current || !versionId) {
      continue;
    }

    const linkedCount = linkCountByJobId.get(jobId) ?? 0;
    const totalItems = estimateItemCountByVersionId.get(versionId) ?? 0;
    current.coveragePercent =
      totalItems > 0
        ? Math.min(100, Math.round((linkedCount / totalItems) * 100))
        : 0;
    current.exceptionCount = decisionCountByJobId.get(jobId) ?? 0;
  }

  return metricsByProjectId;
}

export const fetchDirectionProjectSignals = cache(
  async (
    projectId: string,
    versionId: string
  ): Promise<ProjectAlertSignals> => {
    const version = await getDirectionVersionById(projectId, versionId);

    if (!version) {
      return {
        latestJobId: null,
        alerts: [],
      };
    }

    const ownerOptionsPromise = listDirectionOwnerOptions();
    void ownerOptionsPromise;

    const [context, latestJobsByVersionId, alertsByVersionId, workspace] =
      await Promise.all([
        getAuthenticatedContext(),
        listLatestJobsByVersionId([version.id]),
        listRiskAlertsByVersionId([version.id]),
        fetchAffaireIntakeWorkspace(projectId).catch(() => null),
      ]);
    const plansMetricsByProjectId = await listDirectionPlansMetricsByProjectId(
      context,
      [version],
      latestJobsByVersionId
    ).catch(async (error) => {
      await writeDirectionDebugLog(
        "server",
        `project-signals:metrics-failed project=${projectId} message=${getSafeErrorMessage(error)}`
      );
      return new Map<string, DirectionPlansMetrics>();
    });

    const project = resolveEmbeddedProject(version.estimate_projects);
    if (!project) {
      return {
        latestJobId: null,
        alerts: [],
      };
    }

    const latestJobId = latestJobsByVersionId.get(version.id)?.id ?? null;
    const versionAlerts = alertsByVersionId.get(version.id) ?? [];
    const deadlineAt = deriveDeadlineFromWorkspace(workspace);
    const sendTargetAt = deriveSendTargetAt(deadlineAt, version.updated_at);
    const actionableAlerts = filterAlertsForLatestJob(versionAlerts, latestJobId);
    const plansMetrics = plansMetricsByProjectId.get(projectId);

    return {
      latestJobId,
      alerts: buildDirectionSyntheticAlerts({
        projectId,
        projectName: project.name,
        versionId,
        amountHtCents: version.total_ht_cents ?? 0,
        marginBp: version.margin_bp,
        discountBp: version.discount_bp,
        approvalStatus: version.approval_status,
        exceptionCount:
          plansMetrics?.exceptionCount ?? actionableAlerts.length,
        openHypothesesCount: plansMetrics?.openHypothesesCount ?? 0,
        riskScore: actionableAlerts.reduce(
          (maxScore, alert) => Math.max(maxScore, alert.risk_score),
          0
        ),
        sendTargetAt,
        latestJobId,
        alerts: actionableAlerts,
      }),
    };
  }
);

export async function fetchDirectionDashboardPageData(
  query: DirectionDashboardQuery
): Promise<DirectionDashboardPageData> {
  const [context, versions, ownerOptions] = await Promise.all([
    getAuthenticatedContext(),
    listLatestDirectionVersions(),
    listDirectionOwnerOptions(),
  ]);
  assertDirectionAccess(context.tenantRole);
  await writeDirectionDebugLog(
    "server",
    `page-data:start tenant=${context.tenantId} role=${context.tenantRole} versions=${versions.length} ownerFilter=${query.ownerUserId ?? "all"} lotFilter=${query.lot ?? "all"} horizon=${query.horizon} onlyExceptions=${query.onlyExceptions ? "true" : "false"}`
  );

  const versionIds = versions.map((version) => version.id);

  const [
    { cyclesByVersionId, reviewerStateByCycleId },
    latestJobsByVersionId,
    alertsByVersionId,
  ] = await Promise.all([
    listReviewCyclesByVersionId(versionIds),
    listLatestJobsByVersionId(versionIds),
    listRiskAlertsByVersionId(versionIds),
  ]);
  await writeDirectionDebugLog(
    "server",
    `page-data:deps cycles=${cyclesByVersionId.size} reviewerStates=${reviewerStateByCycleId.size} latestJobs=${latestJobsByVersionId.size} alertBuckets=${alertsByVersionId.size}`
  );
  const plansMetricsByProjectId = await listDirectionPlansMetricsByProjectId(
    context,
    versions,
    latestJobsByVersionId
  ).catch(async (error) => {
    await writeDirectionDebugLog(
      "server",
      `page-data:plans-metrics-failed message=${getSafeErrorMessage(error)}`
    );
    return new Map<string, DirectionPlansMetrics>();
  });

  const profileById = new Map(
    ownerOptions.map((option) => [option.userId, option.label])
  );

  const filteredCards = versions
    .map((version): DirectionPortfolioCard | null => {
      const project = resolveEmbeddedProject(version.estimate_projects);
      if (!project) {
        return null;
      }

      const cycle = cyclesByVersionId.get(version.id) ?? null;
      const reviewerState =
        cycle !== null ? reviewerStateByCycleId.get(cycle.id) ?? null : null;
      const latestJobId = latestJobsByVersionId.get(version.id)?.id ?? null;
      const sendTargetAt = deriveSendTargetAt(null, version.updated_at);
      const rawAlerts = alertsByVersionId.get(version.id) ?? [];
      const actionableAlerts = filterAlertsForLatestJob(rawAlerts, latestJobId);
      const plansMetrics = plansMetricsByProjectId.get(version.project_id);
      const riskScore = actionableAlerts.reduce(
        (maxScore, alert) => Math.max(maxScore, alert.risk_score),
        0
      );
      const alerts = buildDirectionSyntheticAlerts({
        projectId: version.project_id,
        projectName: project.name,
        versionId: version.id,
        amountHtCents: version.total_ht_cents ?? 0,
        marginBp: version.margin_bp,
        discountBp: version.discount_bp,
        approvalStatus: version.approval_status,
        exceptionCount:
          plansMetrics?.exceptionCount ?? actionableAlerts.length,
        openHypothesesCount: plansMetrics?.openHypothesesCount ?? 0,
        riskScore,
        sendTargetAt,
        latestJobId,
        alerts: actionableAlerts,
      });
      const lotLabels = dedupeStrings(
        alerts.flatMap((alert) => alert.lotLabels)
      );

      return {
        projectId: version.project_id,
        versionId: version.id,
        projectName: project.name,
        clientName: project.client_name,
        ownerUserId: project.user_id,
        ownerName: profileById.get(project.user_id) ?? null,
        amountHtCents: version.total_ht_cents ?? 0,
        marginBp: version.margin_bp,
        riskScore,
        coveragePercent: plansMetrics?.coveragePercent ?? null,
        openHypothesesCount: plansMetrics?.openHypothesesCount ?? 0,
        approvalStatus: version.approval_status,
        sendTargetAt,
        exceptionCount:
          plansMetrics?.exceptionCount ?? actionableAlerts.length,
        latestJobId,
        cycleId: cycle?.id ?? null,
        reviewerState,
        lotLabels,
        alerts,
      };
    })
    .filter((card): card is DirectionPortfolioCard => card !== null)
    .filter((card) =>
      query.ownerUserId ? card.ownerUserId === query.ownerUserId : true
    )
    .filter((card) => matchesLot(card, query.lot))
    .filter((card) => isWithinHorizon(card.sendTargetAt, query.horizon))
    .filter((card) =>
      query.onlyExceptions ? card.exceptionCount > 0 || card.alerts.length > 0 : true
    )
    .sort((left, right) => {
      const scoreDelta =
        scoreWeeklyPriority(right) - scoreWeeklyPriority(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.projectName.localeCompare(right.projectName, "fr-FR");
    })
    .map(cloneDirectionPortfolioCard);

  const totalCards = filteredCards.length;
  const totalPages = Math.max(
    1,
    Math.ceil(totalCards / DIRECTION_PORTFOLIO_PAGE_SIZE)
  );
  const currentPage = Math.min(query.page, totalPages);
  const pageStart = (currentPage - 1) * DIRECTION_PORTFOLIO_PAGE_SIZE;
  const cards = filteredCards.slice(
    pageStart,
    pageStart + DIRECTION_PORTFOLIO_PAGE_SIZE
  );

  const weeklyQueue = filteredCards
    .map((card) => ({
      ...cloneDirectionPortfolioCard(card),
      priorityScore: scoreWeeklyPriority(card),
      queueState: deriveWeeklyQueueState(card),
    }))
    .filter((item) => isWithinHorizon(item.sendTargetAt, "this_week"))
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .map(cloneDirectionWeeklyQueueItem);

  const alerts = filteredCards
    .flatMap((card) => card.alerts.map(cloneDirectionSyntheticAlert))
    .sort((left, right) => {
      const levelDelta =
        (right.level === "critical" ? 3 : right.level === "warning" ? 2 : 1) -
        (left.level === "critical" ? 3 : left.level === "warning" ? 2 : 1);

      if (levelDelta !== 0) {
        return levelDelta;
      }

      return left.projectName.localeCompare(right.projectName, "fr-FR");
    });

  const summary: DirectionDashboardSummary = {
    totalAffaires: totalCards,
    criticalCount: filteredCards.filter(
      (card) =>
        card.riskScore >= 70 ||
        card.alerts.some((alert) => alert.level === "critical")
    ).length,
    weeklyCount: weeklyQueue.length,
    validationPendingCount: filteredCards.filter(
      (card) =>
        card.approvalStatus === "required" ||
        card.approvalStatus === "in_review"
    ).length,
  };

  const lotOptions = dedupeStrings(
    filteredCards.flatMap((card) => card.lotLabels)
  ).sort((left, right) => left.localeCompare(right, "fr-FR"));
  const pagination: DirectionDashboardPagination = {
    page: currentPage,
    pageSize: DIRECTION_PORTFOLIO_PAGE_SIZE,
    totalCards,
    totalPages,
    hasPreviousPage: currentPage > 1,
    hasNextPage: currentPage < totalPages,
  };
  await writeDirectionDebugLog(
    "server",
    `page-data:complete totalCards=${totalCards} returnedCards=${cards.length} page=${currentPage}/${totalPages} weeklyQueue=${weeklyQueue.length} alerts=${alerts.length} ownerOptions=${ownerOptions.length} lotOptions=${lotOptions.length}`
  );

  return {
    summary: toJsonValue(summary, {
      totalAffaires: 0,
      criticalCount: 0,
      weeklyCount: 0,
      validationPendingCount: 0,
    }),
    cards: toJsonValue(cards, []),
    weeklyQueue: toJsonValue(weeklyQueue, []),
    alerts: toJsonValue(alerts, []),
    ownerOptions: toJsonValue(
      ownerOptions.map((option) => ({ ...option })),
      []
    ),
    lotOptions: toJsonValue(lotOptions, []),
    pagination: toJsonValue(pagination, {
      page: 1,
      pageSize: DIRECTION_PORTFOLIO_PAGE_SIZE,
      totalCards: 0,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    }),
  };
}

export async function assignDirectionProjectOwner(
  projectId: string,
  ownerUserId: string
): Promise<void> {
  const context = await getAuthenticatedContext();
  assertDirectionAccess(context.tenantRole);

  const { error } = await context.supabase
    .from("estimate_projects")
    .update({ user_id: ownerUserId })
    .eq("tenant_id", context.tenantId)
    .eq("id", projectId);

  if (error) {
    throw mapSupabaseError(error, "Impossible de reassigner cette affaire.");
  }
}

export async function updateDirectionAlertStatus(input: {
  jobId: string;
  versionId: string;
  alertIds: string[];
  status: TakeoffRiskStatus;
  reviewNote?: string | null;
}): Promise<void> {
  const { updateTakeoffRiskAlertStatus } = await import("@/lib/takeoff/server");

  await Promise.all(
    input.alertIds.map((alertId) =>
      updateTakeoffRiskAlertStatus(input.jobId, alertId, {
        version_id: input.versionId,
        status: input.status,
        review_note: input.reviewNote ?? null,
      })
    )
  );
}
