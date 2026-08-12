import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import type { DirectionSyntheticAlert } from "@/lib/direction/alerts";
import { fetchDirectionProjectSignals } from "@/lib/direction/server";
import type { TakeoffRiskCauseCode } from "@/lib/takeoff/types";
import {
  APPROVAL_QUEUE_DEFAULT_DIRECTIONS,
  type ApprovalQueueQuery,
} from "./schemas";

// ---------------------------------------------------------------------------
// Exception group mapping (causeCode → FE exception category)
// ---------------------------------------------------------------------------

export type ExceptionGroupKey =
  | "price"
  | "quantities"
  | "vat_conformity"
  | "missing_proofs"
  | "missing_documents";

const CAUSE_TO_EXCEPTION_GROUP: Record<TakeoffRiskCauseCode, ExceptionGroupKey> = {
  missing_proof: "missing_proofs",
  dpgf_takeoff_gap: "quantities",
  atypical_price: "price",
  insufficient_margin: "price",
  vat_inconsistency: "vat_conformity",
  missing_piece: "missing_documents",
};

const EXCEPTION_GROUP_LABELS: Record<ExceptionGroupKey, string> = {
  price: "Prix",
  quantities: "Quantites",
  vat_conformity: "Conformite TVA",
  missing_proofs: "Preuves manquantes",
  missing_documents: "Pieces manquantes",
};

export { EXCEPTION_GROUP_LABELS };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewerState = "seen" | "review_laurent" | "blocking" | "acceptable";
export type VisualState = "new" | "seen" | "commented" | "resolved";

export type ApprovalQueueItem = {
  projectId: string;
  versionId: string;
  cycleId: string;
  projectName: string;
  clientName: string | null;
  versionLabel: string;
  amountHtCents: number;
  marginBp: number | null;
  riskScore: number;
  exceptionCount: number;
  requestAgeLabel: string;
  requestedAt: string;
  submissionMessage: string | null;
  commentCount: number;
  exceptionGroups: Array<{ key: ExceptionGroupKey; label: string; count: number }>;
  visualState: VisualState;
  reviewerState: ReviewerState | null;
  latestJobId: string | null;
  syntheticAlerts: DirectionSyntheticAlert[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });

function computeRelativeAge(requestedAt: string): string {
  const diffMs = Date.now() - new Date(requestedAt).getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return "a l'instant";
  if (diffMinutes < 60) return RELATIVE_TIME_FORMATTER.format(-diffMinutes, "minute");

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return RELATIVE_TIME_FORMATTER.format(-diffHours, "hour");

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return RELATIVE_TIME_FORMATTER.format(-diffDays, "day");

  const diffMonths = Math.floor(diffDays / 30);
  return RELATIVE_TIME_FORMATTER.format(-diffMonths, "month");
}

function mapCauseCodeCounts(
  raw: Record<string, number>
): ApprovalQueueItem["exceptionGroups"] {
  const grouped: Partial<Record<ExceptionGroupKey, number>> = {};

  for (const [causeCode, count] of Object.entries(raw)) {
    const groupKey = CAUSE_TO_EXCEPTION_GROUP[causeCode as TakeoffRiskCauseCode];
    if (groupKey) {
      grouped[groupKey] = (grouped[groupKey] ?? 0) + count;
    }
  }

  return Object.entries(grouped)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key: key as ExceptionGroupKey,
      label: EXCEPTION_GROUP_LABELS[key as ExceptionGroupKey],
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function deriveVisualState(
  commentCount: number,
  reviewerState: ReviewerState | null
): VisualState {
  if (commentCount > 0) return "commented";
  if (reviewerState) return "seen";
  return "new";
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

type RpcRow = {
  project_id: string;
  version_id: string;
  cycle_id: string;
  project_name: string;
  client_name: string | null;
  version_number: number;
  amount_ht_cents: number;
  margin_bp: number | null;
  requested_at: string;
  submission_message: string | null;
  comment_count: number;
  reviewer_state: ReviewerState | null;
  exception_count: number;
  max_risk_score: number;
  cause_code_counts: Record<string, number>;
  latest_job_id: string | null;
};

export async function fetchApprovalQueue(
  query: ApprovalQueueQuery
): Promise<ApprovalQueueItem[]> {
  const { supabase, tenantRole } = await getAuthenticatedContext();

  if (tenantRole !== "admin" && tenantRole !== "director") {
    return [];
  }

  const { data, error } = await supabase.rpc("list_approval_queue" as never, {
    p_sort_by: query.sortBy,
  } as never);

  if (error) {
    throw new Error(`Erreur lors du chargement de la file d'approbation: ${error.message}`);
  }

  const rows = (data ?? []) as RpcRow[];

  const items: ApprovalQueueItem[] = rows.map((row) => {
    const exceptionGroups = mapCauseCodeCounts(row.cause_code_counts ?? {});
    const reviewerState = row.reviewer_state as ReviewerState | null;

    return {
      projectId: row.project_id,
      versionId: row.version_id,
      cycleId: row.cycle_id,
      projectName: row.project_name,
      clientName: row.client_name,
      versionLabel: `V${row.version_number}`,
      amountHtCents: row.amount_ht_cents ?? 0,
      marginBp: row.margin_bp,
      riskScore: row.max_risk_score ?? 0,
      exceptionCount: row.exception_count ?? 0,
      requestAgeLabel: computeRelativeAge(row.requested_at),
      requestedAt: row.requested_at,
      submissionMessage: row.submission_message,
      commentCount: row.comment_count ?? 0,
      exceptionGroups,
      visualState: deriveVisualState(row.comment_count ?? 0, reviewerState),
      reviewerState,
      latestJobId: row.latest_job_id,
      syntheticAlerts: [],
    };
  });

  const itemsWithSignals = await Promise.all(
    items.map(async (item) => {
      try {
        const signals = await fetchDirectionProjectSignals(item.projectId, item.versionId);
        return {
          ...item,
          marginBp: signals.marginBp ?? item.marginBp,
          syntheticAlerts: signals.alerts,
        };
      } catch {
        return item;
      }
    })
  );

  const filteredItems = query.onlyExceptions
    ? itemsWithSignals.filter(
        (item) => item.exceptionCount > 0 || item.syntheticAlerts.length > 0
      )
    : itemsWithSignals;
  const canonicalDirection = APPROVAL_QUEUE_DEFAULT_DIRECTIONS[query.sortBy];

  if (query.sortBy === "margin") {
    const direction = query.sortDir === "asc" ? 1 : -1;
    return filteredItems.toSorted((left, right) => {
      if (left.marginBp === null) return right.marginBp === null ? 0 : 1;
      if (right.marginBp === null) return -1;
      return (left.marginBp - right.marginBp) * direction;
    });
  }

  return query.sortDir === canonicalDirection
    ? filteredItems
    : filteredItems.toReversed();
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

export async function markApprovalQueueItemState(
  cycleId: string,
  state: ReviewerState
): Promise<void> {
  const { supabase, userId, tenantId, tenantRole } = await getAuthenticatedContext();

  if (tenantRole !== "admin" && tenantRole !== "director") {
    throw new Error("Seuls les administrateurs et directeurs peuvent modifier l'etat de revue.");
  }

  const { error } = await supabase
    .from("approval_queue_reviewer_states" as never)
    .upsert(
      {
        tenant_id: tenantId,
        cycle_id: cycleId,
        reviewer_id: userId,
        state,
      } as never,
      { onConflict: "tenant_id,cycle_id,reviewer_id" }
    );

  if (error) {
    throw new Error(`Erreur lors de la mise a jour de l'etat: ${error.message}`);
  }
}
