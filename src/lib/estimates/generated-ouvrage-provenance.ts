import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type JsonRecord = Record<string, unknown>;
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_metadata?: Json | null;
  source_extracted_at?: string | null;
};

type GeneratedOuvrageFragmentKind =
  | "free_text"
  | "cctp_excerpt"
  | "internal_note"
  | "history"
  | "library";
type GeneratedOuvrageEvidenceKind = "fact" | "hypothesis" | "inference";
type GeneratedOuvrageRiskSignalSeverity = "info" | "warning" | "critical";
type GeneratedOuvrageRiskSignal = {
  label: string;
  severity: GeneratedOuvrageRiskSignalSeverity;
  basis: GeneratedOuvrageEvidenceKind;
};

type GeneratedOuvrageSourceFragmentRow = {
  id: string;
  draft_id: string;
  source_kind: GeneratedOuvrageFragmentKind;
  label: string;
  excerpt: string;
  source_document_id: string | null;
  source_file_name: string | null;
  source_page_from: number | null;
  source_page_to: number | null;
  selection_label: string | null;
};

type GeneratedOuvrageCandidateRow = {
  id: string;
  ai_status: string;
  resolution_status: string;
  confidence: number;
  designation: string;
  unit: string | null;
  quantity: number | null;
};

type GeneratedOuvrageCandidateSourceRow = {
  candidate_id: string;
  source_fragment_id: string;
  source_rank: number;
};

type GeneratedOuvrageApplicationRow = {
  id: string;
  draft_id: string;
  candidate_id: string;
  estimate_item_id: string;
  applied_payload: Json;
};

type GeneratedOuvrageWorkSnapshotRow = {
  id: string;
  assembly_id: string | null;
  estimate_item_id: string;
  summary: Json;
  components: Json;
  metadata: Json;
};

function toNullableText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value)));
}

function toJson(
  value: JsonRecord | JsonRecord[] | string[] | string | number | boolean | null
) {
  return value as Json;
}

function mapFragmentKindToCandidateSourceType(
  kind: GeneratedOuvrageFragmentKind
): "text" | "cctp" | "history" | "library" {
  if (kind === "cctp_excerpt") return "cctp";
  if (kind === "history") return "history";
  if (kind === "library") return "library";
  return "text";
}

function readJsonStringArray(value: Json | unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toNullableText(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8);
}

function normalizeRiskSignals(value: unknown): GeneratedOuvrageRiskSignal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return null;
      }

      const label = toNullableText(
        typeof entry.label === "string" ? entry.label : null
      );
      const severity =
        typeof entry.severity === "string" &&
        ["info", "warning", "critical"].includes(entry.severity)
          ? (entry.severity as GeneratedOuvrageRiskSignalSeverity)
          : null;
      const basis =
        typeof entry.basis === "string" &&
        ["fact", "hypothesis", "inference"].includes(entry.basis)
          ? (entry.basis as GeneratedOuvrageEvidenceKind)
          : null;

      if (!label || !severity || !basis) {
        return null;
      }

      return { label, severity, basis } satisfies GeneratedOuvrageRiskSignal;
    })
    .filter((entry): entry is GeneratedOuvrageRiskSignal => entry !== null)
    .slice(0, 8);
}

export async function enrichEstimateItemsWithGeneratedOuvrageProvenance(input: {
  supabase: Supabase;
  tenantId: string;
  items: EstimateItemRow[];
}) {
  const itemIds = input.items.map((item) => item.id);

  if (itemIds.length === 0) {
    return input.items;
  }

  const { data: applicationData, error: applicationError } = await input.supabase
    .from("estimate_generated_ouvrage_applications" as never)
    .select("*" as never)
    .eq("tenant_id", input.tenantId)
    .in("estimate_item_id", itemIds);

  if (applicationError || !applicationData || applicationData.length === 0) {
    return input.items;
  }

  const applications = applicationData as GeneratedOuvrageApplicationRow[];
  const candidateIds = Array.from(
    new Set(applications.map((row) => row.candidate_id))
  );
  const draftIds = Array.from(new Set(applications.map((row) => row.draft_id)));

  const [
    candidateResult,
    draftResult,
    candidateSourceResult,
    fragmentResult,
    snapshotResult,
  ] = await Promise.all([
    input.supabase
      .from("estimate_generated_ouvrage_candidates" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("id", candidateIds),
    input.supabase
      .from("estimate_generated_ouvrage_drafts" as never)
      .select("id, created_at, generation_metadata" as never)
      .eq("tenant_id", input.tenantId)
      .in("id", draftIds),
    input.supabase
      .from("estimate_generated_ouvrage_candidate_sources" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("candidate_id", candidateIds),
    input.supabase
      .from("estimate_generated_ouvrage_source_fragments" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("draft_id", draftIds),
    input.supabase
      .from("estimate_generated_ouvrage_work_snapshots" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("estimate_item_id", itemIds),
  ]);

  if (
    candidateResult.error ||
    draftResult.error ||
    candidateSourceResult.error ||
    fragmentResult.error ||
    snapshotResult.error
  ) {
    return input.items;
  }

  const candidateById = new Map(
    ((candidateResult.data ?? []) as GeneratedOuvrageCandidateRow[]).map(
      (row) => [row.id, row] as const
    )
  );
  const draftById = new Map(
    ((draftResult.data ?? []) as Array<{
      id: string;
      created_at: string;
      generation_metadata: Json;
    }>).map((row) => [row.id, row] as const)
  );
  const fragmentById = new Map(
    ((fragmentResult.data ?? []) as GeneratedOuvrageSourceFragmentRow[]).map(
      (row) => [row.id, row] as const
    )
  );

  const sourceRowsByCandidateId = new Map<
    string,
    GeneratedOuvrageCandidateSourceRow[]
  >();
  for (const row of (candidateSourceResult.data ??
    []) as GeneratedOuvrageCandidateSourceRow[]) {
    const current = sourceRowsByCandidateId.get(row.candidate_id);
    if (current) {
      current.push(row);
    } else {
      sourceRowsByCandidateId.set(row.candidate_id, [row]);
    }
  }

  const applicationByItemId = new Map(
    applications.map((row) => [row.estimate_item_id, row] as const)
  );
  const snapshotByItemId = new Map(
    ((snapshotResult.data ?? []) as GeneratedOuvrageWorkSnapshotRow[]).map(
      (row) => [row.estimate_item_id, row] as const
    )
  );

  return input.items.map((item) => {
    const application = applicationByItemId.get(item.id);
    if (!application) {
      return item;
    }

    const candidate = candidateById.get(application.candidate_id);
    const draft = draftById.get(application.draft_id);
    const sources = (sourceRowsByCandidateId.get(application.candidate_id) ?? [])
      .sort((left, right) => left.source_rank - right.source_rank)
      .map((row) => fragmentById.get(row.source_fragment_id))
      .filter(
        (fragment): fragment is GeneratedOuvrageSourceFragmentRow =>
          Boolean(fragment)
      )
      .map((fragment) => ({
        source_fragment_id: fragment.id,
        source_document_id: fragment.source_document_id,
        type: mapFragmentKindToCandidateSourceType(fragment.source_kind),
        label: fragment.label,
        excerpt: fragment.excerpt,
        source_file_name: fragment.source_file_name,
        source_page_from: fragment.source_page_from,
        source_page_to: fragment.source_page_to,
        selection_label: fragment.selection_label,
      }));

    const generationMetadata =
      draft?.generation_metadata &&
      typeof draft.generation_metadata === "object"
        ? (draft.generation_metadata as JsonRecord)
        : {};

    const appliedPayload =
      application.applied_payload &&
      typeof application.applied_payload === "object"
        ? (application.applied_payload as JsonRecord)
        : {};
    const snapshot = snapshotByItemId.get(item.id);
    const snapshotMetadata =
      snapshot?.metadata && typeof snapshot.metadata === "object"
        ? (snapshot.metadata as JsonRecord)
        : {};
    const snapshotSummary =
      snapshot?.summary && typeof snapshot.summary === "object"
        ? (snapshot.summary as JsonRecord)
        : {};
    const snapshotComponents = Array.isArray(snapshot?.components)
      ? (snapshot.components as unknown[])
      : [];
    const estimateItemMapping =
      (typeof snapshotMetadata.estimate_item_mapping === "object" &&
      snapshotMetadata.estimate_item_mapping !== null
        ? (snapshotMetadata.estimate_item_mapping as JsonRecord)
        : null) ??
      (typeof appliedPayload.estimate_item_mapping === "object" &&
      appliedPayload.estimate_item_mapping !== null
        ? (appliedPayload.estimate_item_mapping as JsonRecord)
        : null);
    const facts = Array.from(
      new Set([
        ...readJsonStringArray(snapshotSummary.facts),
        ...snapshotComponents.flatMap((component) =>
          typeof component === "object" &&
          component !== null &&
          Array.isArray((component as Record<string, unknown>).facts)
            ? readJsonStringArray(
                (component as Record<string, unknown>).facts as Json
              )
            : []
        ),
      ])
    ).slice(0, 8);
    const hypotheses = Array.from(
      new Set([
        ...readJsonStringArray(snapshotSummary.hypotheses),
        ...snapshotComponents.flatMap((component) =>
          typeof component === "object" &&
          component !== null &&
          Array.isArray((component as Record<string, unknown>).hypotheses)
            ? readJsonStringArray(
                (component as Record<string, unknown>).hypotheses as Json
              )
            : []
        ),
      ])
    ).slice(0, 8);
    const inferences = Array.from(
      new Set([
        ...readJsonStringArray(snapshotSummary.inferences),
        ...snapshotComponents.flatMap((component) =>
          typeof component === "object" &&
          component !== null &&
          Array.isArray((component as Record<string, unknown>).inferences)
            ? readJsonStringArray(
                (component as Record<string, unknown>).inferences as Json
              )
            : []
        ),
      ])
    ).slice(0, 8);

    return {
      ...item,
      source_provider: "generated_ouvrage",
      source_job_id: application.draft_id,
      source_file_name:
        toNullableText(item.source_file_name) ??
        toNullableText(sources[0]?.source_file_name) ??
        "Ouvrage genere",
      source_page: item.source_page ?? sources[0]?.source_page_from ?? null,
      source_extracted_at: draft?.created_at ?? item.source_extracted_at ?? null,
      source_metadata: toJson({
        kind: "generated_ouvrage",
        draft_id: application.draft_id,
        candidate_id: application.candidate_id,
        application_id: application.id,
        snapshot_id: snapshot?.id ?? null,
        assembly_id: snapshot?.assembly_id ?? null,
        ai_status: candidate?.ai_status ?? null,
        resolution_status: candidate?.resolution_status ?? null,
        confidence: candidate ? clampConfidence(candidate.confidence) : null,
        applied_values: {
          designation:
            appliedPayload.designation ?? candidate?.designation ?? item.title,
          unit: appliedPayload.unit ?? candidate?.unit ?? null,
          quantity: appliedPayload.quantity ?? candidate?.quantity ?? null,
          lot_id:
            appliedPayload.resolved_lot_id ?? appliedPayload.lot_id ?? null,
          requested_lot_id: appliedPayload.requested_lot_id ?? null,
          lot_label: appliedPayload.resolved_lot_label ?? null,
          placement_mode: appliedPayload.placement_mode ?? null,
        },
        prompt_version: toNullableText(generationMetadata.prompt_version),
        used_fallback: Boolean(generationMetadata.used_fallback),
        subdetail_summary: snapshotSummary,
        estimate_item_mapping: estimateItemMapping,
        components: snapshotComponents,
        facts,
        hypotheses,
        inferences,
        risk_signals: normalizeRiskSignals(snapshotSummary.risk_signals),
        sources,
      }),
    };
  });
}
