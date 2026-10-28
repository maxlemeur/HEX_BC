import "server-only";

import { type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { z } from "zod";
import { mapSupabaseError } from "@/lib/estimates/errors";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import {
  type TakeoffPriceSuggestionConfidenceLabel,
  type TakeoffPriceSuggestionFactor,
  type TakeoffPriceSuggestionSnapshot,
  type TakeoffPriceSuggestionSourceKind,
} from "@/lib/takeoff/types";
import {
  ESTIMATE_DPGF_COMPARE_SELECT,
  takeoffDpgfCompareEstimateItemRowSchema,
} from "@/lib/takeoff/estimate-line-read-contract";
import {
  type EstimateItemPriceSuggestionRow,
} from "@/lib/takeoff/price-suggestion-preparation";
import { takeoffPriceSuggestionSnapshotSchema } from "@/lib/takeoff/price-suggestion-contracts";

const TAKEOFF_PRICE_SUGGESTIONS_SELECT = [
  "id",
  "created_at",
  "updated_at",
  "tenant_id",
  "project_id",
  "version_id",
  "takeoff_job_id",
  "estimate_item_id",
  "snapshot_fingerprint",
  "status",
  "current_price_cents",
  "low_cents",
  "target_cents",
  "high_cents",
  "confidence_score",
  "confidence_label",
  "candidate_count",
  "outlier_count",
  "justification",
  "factors_json",
  "summary_json",
  "selected_action",
  "selected_price_cents",
  "review_note",
  "reviewed_at",
  "reviewed_by",
  "superseded_at",
].join(", ");

const TAKEOFF_PRICE_SUGGESTION_SOURCES_SELECT = [
  "id",
  "created_at",
  "tenant_id",
  "project_id",
  "version_id",
  "takeoff_job_id",
  "estimate_item_id",
  "suggestion_id",
  "source_kind",
  "kind",
  "label",
  "source_ref",
  "price_cents",
  "freshness_label",
  "confidence_score",
  "rank",
  "is_outlier",
  "source_record_table",
  "source_record_id",
  "metadata_json",
].join(", ");

export type TakeoffPriceSuggestionRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  snapshot_fingerprint: string;
  status: string;
  current_price_cents: number | null;
  low_cents: number;
  target_cents: number;
  high_cents: number;
  confidence_score: number | null;
  confidence_label: string;
  candidate_count: number;
  outlier_count: number;
  justification: string;
  factors_json: unknown;
  summary_json: unknown;
  selected_action: string | null;
  selected_price_cents: number | null;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  superseded_at: string | null;
};

export type TakeoffPriceSuggestionSourceRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  project_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  suggestion_id: string;
  source_kind: string;
  kind: string;
  label: string;
  source_ref: string;
  price_cents: number;
  freshness_label: string | null;
  confidence_score: number | null;
  rank: number;
  is_outlier: boolean;
  source_record_table: string | null;
  source_record_id: string | null;
  metadata_json: unknown;
};

type PriceSuggestionDatabaseContext = {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
};

type PriceSuggestionPatch = Partial<TakeoffPriceSuggestionRow> & {
  superseded_by_suggestion_id?: string | null;
};

export type TakeoffPriceSuggestionInsert = Omit<
  TakeoffPriceSuggestionRow,
  "id" | "created_at" | "updated_at"
> & {
  requested_by: string | null;
  superseded_by_suggestion_id: string | null;
};

export async function updateTakeoffPriceSuggestionRecord(input: PriceSuggestionDatabaseContext & {
  suggestionId: string;
  patch: PriceSuggestionPatch;
}) {
  return input.supabase.from("takeoff_price_suggestions" as never)
    .update(input.patch as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.suggestionId as never);
}

export async function insertTakeoffPriceSuggestion(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  row: TakeoffPriceSuggestionInsert;
}) {
  return input.supabase.from("takeoff_price_suggestions" as never)
    .insert(input.row as never)
    .select(TAKEOFF_PRICE_SUGGESTIONS_SELECT as never)
    .single();
}

export async function insertTakeoffPriceSuggestionSources(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  rows: Array<Pick<TakeoffPriceSuggestionSourceRow,
    "suggestion_id" | "source_kind" | "kind" | "label" | "source_ref" |
    "price_cents" | "freshness_label" | "confidence_score" | "rank" |
    "is_outlier" | "source_record_table" | "source_record_id" | "metadata_json"
  >>;
}) {
  return input.supabase.from("takeoff_price_suggestion_sources" as never)
    .insert(input.rows as never);
}

export async function readTakeoffPriceSuggestionForReview(input: PriceSuggestionDatabaseContext & {
  suggestionId: string;
  versionId: string;
  jobId: string;
}) {
  return input.supabase.from("takeoff_price_suggestions" as never)
    .select(TAKEOFF_PRICE_SUGGESTIONS_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.suggestionId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .maybeSingle();
}

export async function reviewPendingTakeoffPriceSuggestion(input: PriceSuggestionDatabaseContext & {
  suggestionId: string;
  patch: PriceSuggestionPatch;
}) {
  return input.supabase.from("takeoff_price_suggestions" as never)
    .update(input.patch as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.suggestionId as never)
    .eq("status" as never, "pending" as never)
    .select(TAKEOFF_PRICE_SUGGESTIONS_SELECT as never)
    .single();
}

export function parsePriceSuggestionServerResponse<T>(
  schema: z.ZodType<T>, payload: unknown, message: string
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw invalidPriceSuggestionResponse(message);
  }
  return result.data;
}

export function normalizeTakeoffPriceSuggestionRow(row: unknown): TakeoffPriceSuggestionRow {
  if (!isRecord(row)) {
    throw invalidPriceSuggestionResponse("Données takeoff_price_suggestions invalides en base.");
  }

  return {
    id: parsePriceSuggestionServerResponse(z.string().uuid(), row.id, "Suggestion invalide."),
    created_at: parsePriceSuggestionServerResponse(z.string(), row.created_at, "Suggestion invalide."),
    updated_at: parsePriceSuggestionServerResponse(z.string(), row.updated_at, "Suggestion invalide."),
    tenant_id: parsePriceSuggestionServerResponse(z.string().uuid(), row.tenant_id, "Suggestion invalide."),
    project_id: parsePriceSuggestionServerResponse(z.string().uuid(), row.project_id, "Suggestion invalide."),
    version_id: parsePriceSuggestionServerResponse(z.string().uuid(), row.version_id, "Suggestion invalide."),
    takeoff_job_id: parsePriceSuggestionServerResponse(
      z.string().uuid(),
      row.takeoff_job_id,
      "Suggestion invalide."
    ),
    estimate_item_id: parsePriceSuggestionServerResponse(
      z.string().uuid(),
      row.estimate_item_id,
      "Suggestion invalide."
    ),
    snapshot_fingerprint: parsePriceSuggestionServerResponse(
      z.string().min(1),
      row.snapshot_fingerprint,
      "Suggestion invalide."
    ),
    status: parsePriceSuggestionServerResponse(z.string().min(1), row.status, "Suggestion invalide."),
    current_price_cents:
      typeof row.current_price_cents === "number" ? row.current_price_cents : null,
    low_cents: parsePriceSuggestionServerResponse(
      z.number().int().nonnegative(),
      row.low_cents,
      "Suggestion invalide."
    ),
    target_cents: parsePriceSuggestionServerResponse(
      z.number().int().nonnegative(),
      row.target_cents,
      "Suggestion invalide."
    ),
    high_cents: parsePriceSuggestionServerResponse(
      z.number().int().nonnegative(),
      row.high_cents,
      "Suggestion invalide."
    ),
    confidence_score:
      typeof row.confidence_score === "number" ? row.confidence_score : null,
    confidence_label: parsePriceSuggestionServerResponse(
      z.string().min(1),
      row.confidence_label,
      "Suggestion invalide."
    ),
    candidate_count: parsePriceSuggestionServerResponse(
      z.number().int().nonnegative(),
      row.candidate_count,
      "Suggestion invalide."
    ),
    outlier_count: parsePriceSuggestionServerResponse(
      z.number().int().nonnegative(),
      row.outlier_count,
      "Suggestion invalide."
    ),
    justification: parsePriceSuggestionServerResponse(
      z.string().min(1),
      row.justification,
      "Suggestion invalide."
    ),
    factors_json: row.factors_json,
    summary_json: row.summary_json,
    selected_action: typeof row.selected_action === "string" ? row.selected_action : null,
    selected_price_cents:
      typeof row.selected_price_cents === "number" ? row.selected_price_cents : null,
    review_note: typeof row.review_note === "string" ? row.review_note : null,
    reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    reviewed_by: typeof row.reviewed_by === "string" ? row.reviewed_by : null,
    superseded_at: typeof row.superseded_at === "string" ? row.superseded_at : null,
  };
}

function normalizeTakeoffPriceSuggestionSourceRows(
  rows: unknown[]
): TakeoffPriceSuggestionSourceRow[] {
  return rows.map((row) => {
    if (!isRecord(row)) {
      throw invalidPriceSuggestionResponse("Données takeoff_price_suggestion_sources invalides en base.");
    }

    return {
      id: parsePriceSuggestionServerResponse(z.string().uuid(), row.id, "Source de suggestion invalide."),
      created_at: parsePriceSuggestionServerResponse(
        z.string(),
        row.created_at,
        "Source de suggestion invalide."
      ),
      tenant_id: parsePriceSuggestionServerResponse(
        z.string().uuid(),
        row.tenant_id,
        "Source de suggestion invalide."
      ),
      project_id: parsePriceSuggestionServerResponse(
        z.string().uuid(),
        row.project_id,
        "Source de suggestion invalide."
      ),
      version_id: parsePriceSuggestionServerResponse(
        z.string().uuid(),
        row.version_id,
        "Source de suggestion invalide."
      ),
      takeoff_job_id: parsePriceSuggestionServerResponse(
        z.string().uuid(),
        row.takeoff_job_id,
        "Source de suggestion invalide."
      ),
      estimate_item_id: parsePriceSuggestionServerResponse(
        z.string().uuid(),
        row.estimate_item_id,
        "Source de suggestion invalide."
      ),
      suggestion_id: parsePriceSuggestionServerResponse(
        z.string().uuid(),
        row.suggestion_id,
        "Source de suggestion invalide."
      ),
      source_kind: parsePriceSuggestionServerResponse(
        z.string().min(1),
        row.source_kind,
        "Source de suggestion invalide."
      ),
      kind: parsePriceSuggestionServerResponse(z.string().min(1), row.kind, "Source de suggestion invalide."),
      label: parsePriceSuggestionServerResponse(z.string().min(1), row.label, "Source de suggestion invalide."),
      source_ref: parsePriceSuggestionServerResponse(
        z.string().min(1),
        row.source_ref,
        "Source de suggestion invalide."
      ),
      price_cents: parsePriceSuggestionServerResponse(
        z.number().int().nonnegative(),
        row.price_cents,
        "Source de suggestion invalide."
      ),
      freshness_label:
        typeof row.freshness_label === "string" ? row.freshness_label : null,
      confidence_score:
        typeof row.confidence_score === "number" ? row.confidence_score : null,
      rank: parsePriceSuggestionServerResponse(
        z.number().int().positive(),
        row.rank,
        "Source de suggestion invalide."
      ),
      is_outlier: Boolean(row.is_outlier),
      source_record_table:
        typeof row.source_record_table === "string" ? row.source_record_table : null,
      source_record_id:
        typeof row.source_record_id === "string" ? row.source_record_id : null,
      metadata_json: isRecord(row.metadata_json) ? row.metadata_json : {},
    };
  });
}

export function mapTakeoffPriceSuggestionSnapshot(input: {
  row: TakeoffPriceSuggestionRow;
  sourceRows: TakeoffPriceSuggestionSourceRow[];
}): TakeoffPriceSuggestionSnapshot {
  return parsePriceSuggestionServerResponse(
    takeoffPriceSuggestionSnapshotSchema,
    {
      suggestion_id: input.row.id,
      line_id: input.row.estimate_item_id,
      version_id: input.row.version_id,
      job_id: input.row.takeoff_job_id,
      current_price_cents: input.row.current_price_cents,
      low_cents: input.row.low_cents,
      target_cents: input.row.target_cents,
      high_cents: input.row.high_cents,
      confidence_score: input.row.confidence_score,
      confidence_label: input.row
        .confidence_label as TakeoffPriceSuggestionConfidenceLabel,
      candidate_count: input.row.candidate_count,
      outlier_count: input.row.outlier_count,
      justification: input.row.justification,
      factors: input.row.factors_json,
      summary: input.row.summary_json,
      status: input.row.status,
      selected_action: input.row.selected_action,
      selected_price_cents: input.row.selected_price_cents,
      review_note: input.row.review_note,
      reviewed_at: input.row.reviewed_at,
      reviewed_by: input.row.reviewed_by,
      created_at: input.row.created_at,
      updated_at: input.row.updated_at,
      sources: input.sourceRows
        .slice()
        .sort((left, right) => left.rank - right.rank)
        .map((sourceRow) => ({
          source_id: sourceRow.id,
          source_kind: sourceRow.source_kind as TakeoffPriceSuggestionSourceKind,
          kind: sourceRow.kind as TakeoffPriceSuggestionFactor["kind"],
          label: sourceRow.label,
          source_ref: sourceRow.source_ref,
          price_cents: sourceRow.price_cents,
          freshness_label: sourceRow.freshness_label,
          confidence_score: sourceRow.confidence_score,
          rank: sourceRow.rank,
          is_outlier: sourceRow.is_outlier,
          source_record_table: sourceRow.source_record_table,
          source_record_id: sourceRow.source_record_id,
          metadata: isRecord(sourceRow.metadata_json) ? sourceRow.metadata_json : {},
        })),
    },
    "Suggestion de prix invalide."
  );
}

function normalizeEstimateItemPriceSuggestionRow(
  row: unknown
): EstimateItemPriceSuggestionRow {
  const parsed = parsePriceSuggestionServerResponse(
    takeoffDpgfCompareEstimateItemRowSchema,
    row,
    "Données estimate_items invalides pour la suggestion de prix."
  );

  return {
    id: parsed.id,
    version_id: parsed.version_id,
    position: parsed.position,
    title: parsed.title,
    description: parsed.description,
    quantity: parsed.quantity,
    selected_supplier_price_id: parsed.selected_supplier_price_id ?? null,
    source_file_name: parsed.source_file_name,
    source_page: parsed.source_page,
    source_provider: parsed.source_provider ?? null,
    item_type: parsed.item_type,
    unit: parsed.unit ?? null,
    category_id: parsed.category_id ?? null,
    unit_price_ht_cents: parsed.unit_price_ht_cents ?? null,
    updated_at: parsed.updated_at,
  };
}

export async function listTakeoffPriceCandidateEstimateItems(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items" as never)
    .select(
      [
        "id",
        "tenant_id",
        "version_id",
        "position",
        "title",
        "description",
        "quantity",
        "selected_supplier_price_id",
        "source_file_name",
        "source_page",
        "source_provider",
        "item_type",
        "category_id",
        "unit_price_ht_cents",
        "updated_at",
      ].join(", ") as never
    )
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("item_type" as never, "line" as never)
    .order("updated_at" as never, { ascending: false })
    .limit(250);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger l'historique interne des prix."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return ((data ?? []) as unknown[]).map((row) =>
    normalizeEstimateItemPriceSuggestionRow(row)
  );
}

export async function getTakeoffPriceSuggestionLineOrThrow(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  estimateItemId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items" as never)
    .select(ESTIMATE_DPGF_COMPARE_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.estimateItemId as never)
    .eq("version_id" as never, input.versionId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger la ligne cible."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  if (!data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Ligne DPGF introuvable.",
      details: {
        estimate_item_id: input.estimateItemId,
      },
      retryable: false,
    });
  }

  const line = normalizeEstimateItemPriceSuggestionRow(data);
  if (
    line.item_type !== "line" ||
    (line.source_provider !== "dpgf" && line.source_file_name === null)
  ) {
    throw new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "La ligne cible n'est pas une ligne DPGF eligible.",
      details: {
        estimate_item_id: input.estimateItemId,
      },
      retryable: false,
    });
  }

  return line;
}

export async function getEstimateVersionsForPriceSuggestion(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionIds: string[];
}) {
  const uniqueVersionIds = [...new Set(input.versionIds)];
  if (uniqueVersionIds.length === 0) {
    return new Map<string, { project_id: string; version_number: number | null }>();
  }

  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, project_id, version_number" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .in("id" as never, uniqueVersionIds as never);

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les versions de l'historique prix."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return new Map(
    ((data ?? []) as Array<{
      id: string;
      project_id: string;
      version_number: number | null;
    }>).map((row) => [
      row.id,
      {
        project_id: row.project_id,
        version_number: row.version_number,
      },
    ])
  );
}

export async function getActiveTakeoffPriceSuggestionRow(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  versionId: string;
  jobId: string;
  estimateItemId: string;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_price_suggestions" as never)
    .select(TAKEOFF_PRICE_SUGGESTIONS_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("takeoff_job_id" as never, input.jobId as never)
    .eq("estimate_item_id" as never, input.estimateItemId as never)
    .is("superseded_at" as never, null)
    .order("created_at" as never, { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger la suggestion de prix active."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return data ? normalizeTakeoffPriceSuggestionRow(data) : null;
}

export async function listTakeoffPriceSuggestionSourceRows(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  suggestionId: string;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_price_suggestion_sources" as never)
    .select(TAKEOFF_PRICE_SUGGESTION_SOURCES_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("suggestion_id" as never, input.suggestionId as never)
    .order("rank" as never, { ascending: true });

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de charger les sources de suggestion de prix."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
      }
    );
  }

  return normalizeTakeoffPriceSuggestionSourceRows((data ?? []) as unknown[]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidPriceSuggestionResponse(message: string) {
  return new TakeoffError({
    code: TakeoffErrorCode.INTERNAL_ERROR,
    status: 500,
    message: `${message} Rechargez la suggestion avant toute nouvelle action.`,
    details: { reason: "INVALID_PRICE_SUGGESTION_RESPONSE" },
    retryable: false,
  });
}
