import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AffaireIntakeLeaseUnavailableError } from "@/lib/workflows/affaire-intake-lifecycle";
import { IntakePayerAccessLost } from "@/lib/affaires/intake-payer-server";
import { conflict, internalError } from "@/lib/http/api-response";
import {
  affaireIntakeBriefBlockKeySchema,
  affaireIntakeBriefDraftSchema,
  affaireIntakeBriefStatusSchema,
  normalizeAffaireIntakeTextList,
  type AffaireIntakeBriefBlockKey,
  type AffaireIntakeBriefDraft,
  type AffaireIntakeBriefStatus,
} from "@/lib/affaires/intake";
import type { AffaireAccessProject } from "@/lib/affaires/access-server";
import { isRecord, toStringOrNull } from "@/lib/value-guards";
import {
  type AffaireIntakeSupabaseClient,
  toNumberOrZero,
  resolveSupabaseQuery,
  getAffaireIntakeInsertTable,
  getAffaireIntakeDeleteTable,
  insertAffaireIntakeEvent,
} from "@/lib/affaires/intake-rows";
import { AFFAIRE_BRIEF_PROMPT_VERSION } from "@/lib/affaires/intake-brief-generation";

type AffaireBriefRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  upload_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  confirmed_by: string | null;
  status: AffaireIntakeBriefStatus;
  summary: string;
  project_object: string;
  scope: string[];
  lots: string[];
  received_pieces: string[];
  assumptions: string[];
  vigilance_points: string[];
  missing_elements: string[];
  generation_metadata: Record<string, unknown>;
  last_generated_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

type AffaireBriefSourceRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  brief_id: string;
  source_document_id: string;
  created_by: string | null;
  block_key: AffaireIntakeBriefBlockKey;
  entry_index: number;
  source_file_name: string;
  rationale: string | null;
  created_at: string;
};

export const BRIEF_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "upload_id",
  "created_by",
  "updated_by",
  "confirmed_by",
  "status",
  "summary",
  "project_object",
  "scope",
  "lots",
  "received_pieces",
  "assumptions",
  "vigilance_points",
  "missing_elements",
  "generation_metadata",
  "last_generated_at",
  "confirmed_at",
  "created_at",
  "updated_at",
].join(", ");
const BRIEF_SOURCE_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "brief_id",
  "source_document_id",
  "created_by",
  "block_key",
  "entry_index",
  "source_file_name",
  "rationale",
  "created_at",
].join(", ");

function normalizeJsonTextArray(
  value: unknown,
  maxItems: number,
  maxLength: number
) {
  const values = Array.isArray(value)
    ? value
    : Array.isArray((value as { values?: unknown[] } | null)?.values)
      ? ((value as { values?: unknown[] }).values ?? [])
      : [];

  return normalizeAffaireIntakeTextList(
    values.map((item) => (typeof item === "string" ? item : null)),
    {
      maxItems,
      maxLength,
    }
  );
}

export function normalizeAffaireBriefRow(row: unknown): AffaireBriefRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const status = affaireIntakeBriefStatusSchema.safeParse(row.status);
  if (
    !status.success ||
    typeof row.id !== "string" ||
    typeof row.summary !== "string" ||
    typeof row.project_object !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    project_id: typeof row.project_id === "string" ? row.project_id : "",
    upload_id: toStringOrNull(row.upload_id),
    created_by: toStringOrNull(row.created_by),
    updated_by: toStringOrNull(row.updated_by),
    confirmed_by: toStringOrNull(row.confirmed_by),
    status: status.data,
    summary: row.summary.trim(),
    project_object: row.project_object.trim(),
    scope: normalizeJsonTextArray(row.scope, 12, 280),
    lots: normalizeJsonTextArray(row.lots, 20, 160),
    received_pieces: normalizeJsonTextArray(row.received_pieces, 20, 255),
    assumptions: normalizeJsonTextArray(row.assumptions, 12, 280),
    vigilance_points: normalizeJsonTextArray(row.vigilance_points, 12, 280),
    missing_elements: normalizeJsonTextArray(row.missing_elements, 12, 280),
    generation_metadata: isRecord(row.generation_metadata)
      ? row.generation_metadata
      : {},
    last_generated_at: toStringOrNull(row.last_generated_at),
    confirmed_at: toStringOrNull(row.confirmed_at),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function normalizeAffaireBriefSourceRow(row: unknown): AffaireBriefSourceRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const blockKey = affaireIntakeBriefBlockKeySchema.safeParse(row.block_key);
  if (
    !blockKey.success ||
    typeof row.id !== "string" ||
    typeof row.brief_id !== "string" ||
    typeof row.source_document_id !== "string" ||
    typeof row.source_file_name !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    project_id: typeof row.project_id === "string" ? row.project_id : "",
    brief_id: row.brief_id,
    source_document_id: row.source_document_id,
    created_by: toStringOrNull(row.created_by),
    block_key: blockKey.data,
    entry_index: Math.max(0, Math.trunc(toNumberOrZero(row.entry_index))),
    source_file_name: row.source_file_name.trim(),
    rationale: toStringOrNull(row.rationale),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
  };
}

export async function replaceAffaireBriefSourceLinks(input: {
  supabase: AffaireIntakeSupabaseClient;
  briefId: string;
  sources: AffaireIntakeBriefDraft["sources"];
  actorUserId?: string | null;
}) {
  const { error: deleteError } = await resolveSupabaseQuery<{ error: unknown }>(
    getAffaireIntakeDeleteTable(input.supabase, "affaire_brief_source_links")
      .delete()
      .eq("brief_id", input.briefId)
  );

  if (deleteError) {
    throw internalError("Impossible de remplacer les sources du brief affaire.", deleteError);
  }

  if (input.sources.length === 0) {
    return;
  }

  const { error: insertSourceError } = await resolveSupabaseQuery<{
    error: unknown;
  }>(
    getAffaireIntakeInsertTable(input.supabase, "affaire_brief_source_links")
      .insert(
        input.sources.map((source) => ({
          brief_id: input.briefId,
          source_document_id: source.sourceDocumentId,
          created_by: input.actorUserId ?? null,
          block_key: source.blockKey,
          entry_index: source.entryIndex,
          source_file_name: source.sourceFileName,
          rationale: source.rationale,
        }))
      )
  );

  if (insertSourceError) {
    throw internalError(
      "Impossible de persister les sources du brief affaire.",
      insertSourceError
    );
  }
}

export function normalizeAffaireBriefDraftFromRows(input: {
  brief: AffaireBriefRow;
  sources: AffaireBriefSourceRow[];
}): AffaireIntakeBriefDraft {
  return affaireIntakeBriefDraftSchema.parse({
    status: input.brief.status,
    summary: input.brief.summary,
    projectObject: input.brief.project_object,
    scope: input.brief.scope,
    lots: input.brief.lots,
    receivedPieces: input.brief.received_pieces,
    assumptions: input.brief.assumptions,
    vigilancePoints: input.brief.vigilance_points,
    missingElements: input.brief.missing_elements,
    resolvedPlanGapIndexes: Array.isArray(input.brief.generation_metadata.resolved_plan_gap_indexes)
      ? input.brief.generation_metadata.resolved_plan_gap_indexes.filter((value): value is number =>
          typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 12).slice(0, 12)
      : [],
    updatedAt: input.brief.updated_at,
    sources: input.sources.map((source) => ({
      blockKey: source.block_key,
      entryIndex: source.entry_index,
      sourceDocumentId: source.source_document_id,
      sourceFileName: source.source_file_name,
      rationale: source.rationale,
    })),
    uploadId: input.brief.upload_id,
    lastGeneratedAt: input.brief.last_generated_at,
    confirmedAt: input.brief.confirmed_at,
  });
}

export function getComparableBriefPayload(brief: AffaireIntakeBriefDraft) {
  return JSON.stringify({
    summary: brief.summary,
    projectObject: brief.projectObject,
    scope: brief.scope,
    lots: brief.lots,
    receivedPieces: brief.receivedPieces,
    assumptions: brief.assumptions,
    vigilancePoints: brief.vigilancePoints,
    missingElements: brief.missingElements,
    resolvedPlanGapIndexes: brief.resolvedPlanGapIndexes ?? [],
    sources: [...brief.sources].sort((left, right) =>
      `${left.blockKey}:${left.entryIndex}:${left.sourceDocumentId}`.localeCompare(
        `${right.blockKey}:${right.entryIndex}:${right.sourceDocumentId}`,
        "fr"
      )
    ),
  });
}

export async function fetchAffaireBriefForProject(input: {
  supabase: AffaireIntakeSupabaseClient;
  projectId: string;
}) {
  const briefTable = input.supabase.from("affaire_briefs") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean }
        ) => {
          maybeSingle: () => PromiseLike<unknown>;
        };
      };
    };
  };
  const { data, error } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    briefTable
      .select(BRIEF_SELECT)
      .eq("project_id", input.projectId)
      .order("updated_at", { ascending: false })
      .maybeSingle()
  );

  if (error) {
    throw internalError("Impossible de charger le brief affaire.", error);
  }

  const brief = normalizeAffaireBriefRow(data);
  if (!brief) {
    return null;
  }

  const sourceTable = input.supabase.from("affaire_brief_source_links") as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean }
        ) => PromiseLike<unknown>;
      };
    };
  };
  const { data: sourceData, error: sourceError } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    sourceTable
      .select(BRIEF_SOURCE_SELECT)
      .eq("brief_id", brief.id)
      .order("block_key", { ascending: true })
  );

  if (sourceError) {
    throw internalError("Impossible de charger les sources du brief affaire.", sourceError);
  }

  const sources = (sourceData ?? [])
    .map(normalizeAffaireBriefSourceRow)
    .filter((row): row is AffaireBriefSourceRow => row !== null)
    .sort((left, right) =>
      `${left.block_key}:${left.entry_index}:${left.source_document_id}`.localeCompare(
        `${right.block_key}:${right.entry_index}:${right.source_document_id}`,
        "fr"
      )
    );

  return {
    brief,
    sources,
    draft: normalizeAffaireBriefDraftFromRows({
      brief,
      sources,
    }),
  };
}

export async function persistAffaireBriefDraft(input: {
  supabase: AffaireIntakeSupabaseClient;
  service: ReturnType<typeof createServiceRoleClient>;
  project: AffaireAccessProject;
  uploadId: string;
  draft: AffaireIntakeBriefDraft | null;
  expectedRevision: string;
  expectedBriefUpdatedAt: string | null;
  leaseToken: string | null;
  existing: Awaited<ReturnType<typeof fetchAffaireBriefForProject>>;
  actorUserId?: string | null;
}) {
  const { draft, existing } = input;
  const payload = draft ? {
    status: existing?.brief.status ?? "a_confirmer",
    summary: draft.summary, project_object: draft.projectObject, scope: draft.scope, lots: draft.lots,
    received_pieces: draft.receivedPieces, assumptions: draft.assumptions,
    vigilance_points: draft.vigilancePoints, missing_elements: draft.missingElements,
    generation_metadata: { prompt_version: AFFAIRE_BRIEF_PROMPT_VERSION, generated_from_upload_id: input.uploadId,
      input_revision: input.expectedRevision, regenerated_by: input.actorUserId ?? null },
    last_generated_at: draft.lastGeneratedAt,
  } : null;
  const { error } = await input.service.rpc("publish_affaire_intake_brief", {
    p_upload_id: input.uploadId, p_lease_token: input.leaseToken, p_actor_id: input.actorUserId ?? null,
    p_expected_revision: input.expectedRevision, p_expected_brief_updated_at: input.expectedBriefUpdatedAt,
    p_draft: payload, p_sources: draft?.sources ?? [],
  });
  if (error) {
    if (error.message === "INTAKE_LEASE_LOST") throw new AffaireIntakeLeaseUnavailableError(input.uploadId);
    if (error.message === "INTAKE_PUBLICATION_FORBIDDEN") throw new IntakePayerAccessLost();
    if (error.message === "INTAKE_BRIEF_INPUT_CHANGED") throw conflict("Les pièces ou le brief ont changé pendant la préparation. Actualisez le dossier.");
    throw internalError("Impossible de publier le brief et ses sources.", error);
  }
  if (draft && (!existing || existing.brief.upload_id !== input.uploadId || getComparableBriefPayload(existing.draft) !== getComparableBriefPayload(draft))) {
    await insertAffaireIntakeEvent({ supabase: input.supabase, uploadId: input.uploadId, actorUserId: input.actorUserId,
      eventType: "brief.generated", beforePayload: existing ? { status: existing.brief.status, summary: existing.brief.summary } : null,
      afterPayload: { summary: draft.summary, scope_count: draft.scope.length, assumption_count: draft.assumptions.length } });
  }
  return draft;
}
