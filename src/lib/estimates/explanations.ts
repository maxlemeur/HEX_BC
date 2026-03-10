import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { formatEUR } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import {
  estimateExplanationConfidenceLabelSchema,
  estimateExplanationImpactSummarySchema,
  estimateExplanationKindSchema,
  estimateExplanationProvenanceSchema,
  estimateExplanationRiskSignalSchema,
  estimateExplanationSnapshotSchema,
  estimateExplanationStatementSchema,
  type EstimateExplanationConfidenceLabel,
  type EstimateExplanationImpactSummary,
  type EstimateExplanationKind,
  type EstimateExplanationRiskSignal,
  type EstimateExplanationSnapshot,
  type EstimateExplanationStatement,
} from "@/lib/estimates/explanation-schemas";
import {
  badRequest,
  conflict,
  internalError,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "@/lib/estimates/errors";
import {
  buildEstimateDiff,
  type EstimateDiffEntry,
  type EstimateVersionDetailsForDiff,
} from "@/lib/estimates/diff";
import { getEstimateVersionDetails } from "@/lib/estimates/server";

const ESTIMATE_EXPLANATIONS_SELECT = [
  "id",
  "created_at",
  "updated_at",
  "tenant_id",
  "project_id",
  "version_id",
  "line_id",
  "compare_version_id",
  "requested_by",
  "explanation_kind",
  "snapshot_fingerprint",
  "summary_short",
  "summary_detail",
  "confidence_label",
  "confidence_score",
  "used_fallback",
  "provider",
  "model",
  "statements_json",
  "risk_signals_json",
  "impact_summary_json",
  "metadata_json",
  "generated_at",
  "superseded_at",
  "superseded_by_explanation_id",
].join(", ");

const ESTIMATE_EXPLANATION_SOURCES_SELECT = [
  "id",
  "explanation_id",
  "source_kind",
  "label",
  "source_ref",
  "confidence_score",
  "rank",
  "source_record_table",
  "source_record_id",
  "metadata_json",
].join(", ");

const TAKEOFF_PRICE_SUGGESTIONS_SELECT = [
  "id",
  "version_id",
  "takeoff_job_id",
  "estimate_item_id",
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
  "summary_json",
].join(", ");

const TAKEOFF_PRICE_SUGGESTION_SOURCES_SELECT = [
  "id",
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

const ESTIMATE_LINE_EVIDENCES_SELECT = [
  "id",
  "evidence_type",
  "evidence_kind",
  "label",
  "source_label",
  "source_file_name",
  "source_page",
  "confidence_score",
  "note",
  "source_record_table",
  "source_record_id",
].join(", ");

const ESTIMATE_RISK_ALERTS_SELECT = [
  "id",
  "severity",
  "cause_code",
  "scope_label",
  "reason_labels",
  "metadata",
].join(", ");

const ESTIMATE_EXPLANATION_PROMPT_VERSION = "estimate-explanation-v1";
const ESTIMATE_EXPLANATION_MODEL = "gemini-3-pro-preview";
const ESTIMATE_EXPLANATION_THINKING_LEVEL = "medium" as const;
const ESTIMATE_DELTA_NARRATIVE_STRATEGY_VERSION = "delta-fallback-v1";
const MAX_STATEMENTS_PER_BUCKET = 6;
const MAX_PROVENANCE_ITEMS = 8;
const MAX_TOP_DRIVERS = 3;

const explanationNarrativeSchema = z.object({
  summary_short: z.string().trim().min(1).max(320),
  summary_detail: z.string().trim().min(1).max(2400),
});

const statementsJsonSchema = z.object({
  facts: z.array(estimateExplanationStatementSchema).default([]),
  hypotheses: z.array(estimateExplanationStatementSchema).default([]),
  inferences: z.array(estimateExplanationStatementSchema).default([]),
});

const rowSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid(),
  version_id: z.string().uuid(),
  line_id: z.string().uuid().nullable(),
  compare_version_id: z.string().uuid().nullable(),
  requested_by: z.string().uuid().nullable(),
  explanation_kind: estimateExplanationKindSchema,
  snapshot_fingerprint: z.string().trim().min(1),
  summary_short: z.string().trim().min(1),
  summary_detail: z.string().trim().min(1),
  confidence_label: estimateExplanationConfidenceLabelSchema,
  confidence_score: z.number().min(0).max(1).nullable(),
  used_fallback: z.boolean(),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1).nullable(),
  statements_json: z.unknown(),
  risk_signals_json: z.unknown(),
  impact_summary_json: z.unknown(),
  metadata_json: z.unknown(),
  generated_at: z.string(),
  superseded_at: z.string().nullable(),
  superseded_by_explanation_id: z.string().uuid().nullable(),
});

const sourceRowSchema = z.object({
  id: z.string().uuid(),
  explanation_id: z.string().uuid(),
  source_kind: z.string().trim().min(1),
  label: z.string().trim().min(1),
  source_ref: z.string().nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
  rank: z.number().int(),
  source_record_table: z.string().nullable(),
  source_record_id: z.string().uuid().nullable(),
  metadata_json: z.unknown(),
});

const priceSuggestionRowSchema = z.object({
  id: z.string().uuid(),
  version_id: z.string().uuid(),
  takeoff_job_id: z.string().uuid(),
  estimate_item_id: z.string().uuid(),
  status: z.string(),
  current_price_cents: z.number().int().nullable(),
  low_cents: z.number().int(),
  target_cents: z.number().int(),
  high_cents: z.number().int(),
  confidence_score: z.number().min(0).max(1).nullable(),
  confidence_label: z.string(),
  candidate_count: z.number().int(),
  outlier_count: z.number().int(),
  justification: z.string(),
  summary_json: z.unknown(),
});

const priceSuggestionSourceRowSchema = z.object({
  id: z.string().uuid(),
  suggestion_id: z.string().uuid(),
  source_kind: z.string(),
  kind: z.enum(["fact", "hypothesis", "inference"]),
  label: z.string(),
  source_ref: z.string(),
  price_cents: z.number().int(),
  freshness_label: z.string().nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
  rank: z.number().int(),
  is_outlier: z.boolean(),
  source_record_table: z.string().nullable(),
  source_record_id: z.string().uuid().nullable(),
  metadata_json: z.unknown(),
});

const evidenceRowSchema = z.object({
  id: z.string().uuid(),
  evidence_type: z.string(),
  evidence_kind: z.enum(["fact", "hypothesis", "inference"]),
  label: z.string(),
  source_label: z.string(),
  source_file_name: z.string().nullable(),
  source_page: z.number().int().nullable(),
  confidence_score: z.number().min(0).max(1).nullable(),
  note: z.string().nullable(),
  source_record_table: z.string().nullable(),
  source_record_id: z.string().uuid().nullable(),
});

const riskAlertRowSchema = z.object({
  id: z.string().uuid(),
  severity: z.enum(["low", "medium", "high"]),
  cause_code: z.string(),
  scope_label: z.string(),
  reason_labels: z.array(z.string()).nullable().optional(),
  metadata: z.unknown().optional(),
});

type EstimateExplanationRow = z.infer<typeof rowSchema>;
type EstimateExplanationSourceRow = z.infer<typeof sourceRowSchema>;
type TakeoffPriceSuggestionRow = z.infer<typeof priceSuggestionRowSchema>;
type TakeoffPriceSuggestionSourceRow = z.infer<
  typeof priceSuggestionSourceRowSchema
>;
type EstimateLineEvidenceRow = z.infer<typeof evidenceRowSchema>;
type EstimateRiskAlertRow = z.infer<typeof riskAlertRowSchema>;
type EstimateExplanationVersionDetails = Awaited<
  ReturnType<typeof getEstimateVersionDetails>
>;

type StatementBuckets = {
  facts: EstimateExplanationStatement[];
  hypotheses: EstimateExplanationStatement[];
  inferences: EstimateExplanationStatement[];
};

type ExplanationSourceInsert = {
  source_kind: string;
  label: string;
  source_ref: string | null;
  confidence_score: number | null;
  rank: number;
  source_record_table: string | null;
  source_record_id: string | null;
  metadata_json: Record<string, unknown>;
};

type NormalizedExplanationPayload = {
  kind: EstimateExplanationKind;
  version_id: string;
  line_id: string | null;
  compare_version_id: string | null;
  summary_context: Record<string, unknown>;
  statements: StatementBuckets;
  provenance: ExplanationSourceInsert[];
  risk_signals: EstimateExplanationRiskSignal[];
  impact_summary: EstimateExplanationImpactSummary;
  confidence_label: EstimateExplanationConfidenceLabel;
  confidence_score: number;
};

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatVersionLabel(input: {
  version_number: number;
  title: string | null;
}) {
  const baseLabel = `V${input.version_number}`;
  const title = toNonEmptyString(input.title);
  return title ? `${baseLabel} - ${title}` : baseLabel;
}

function formatPageReference(fileName: string | null | undefined, page: number | null | undefined) {
  const normalizedFile = toNonEmptyString(fileName);
  if (normalizedFile && typeof page === "number" && page > 0) {
    return `${normalizedFile} · page ${page}`;
  }
  if (normalizedFile) {
    return normalizedFile;
  }
  if (typeof page === "number" && page > 0) {
    return `page ${page}`;
  }
  return null;
}

function pushStatement(
  list: EstimateExplanationStatement[],
  statement: EstimateExplanationStatement
) {
  if (list.some((entry) => entry.label === statement.label)) {
    return;
  }
  if (list.length >= MAX_STATEMENTS_PER_BUCKET) {
    return;
  }
  list.push(statement);
}

function pushSource(
  list: ExplanationSourceInsert[],
  source: Omit<ExplanationSourceInsert, "rank">
) {
  if (
    list.some(
      (entry) =>
        entry.source_kind === source.source_kind &&
        entry.label === source.label &&
        entry.source_ref === source.source_ref
    )
  ) {
    return;
  }

  if (list.length >= MAX_PROVENANCE_ITEMS) {
    return;
  }

  list.push({
    ...source,
    rank: list.length,
  });
}

function buildConfidence(input: {
  facts: number;
  hypotheses: number;
  inferences: number;
  provenance: number;
  riskSignals: EstimateExplanationRiskSignal[];
}) {
  let score = 0.35;
  score += Math.min(input.facts, 4) * 0.12;
  score += Math.min(input.provenance, 4) * 0.05;
  score -= Math.min(input.hypotheses, 3) * 0.04;
  score -= Math.min(input.inferences, 3) * 0.05;
  score -= input.riskSignals.some((signal) => signal.severity === "high") ? 0.08 : 0;
  const normalized = Math.min(0.95, Math.max(0.2, Number(score.toFixed(2))));
  const label: EstimateExplanationConfidenceLabel =
    normalized >= 0.75 ? "high" : normalized >= 0.5 ? "medium" : "low";
  return { confidence_label: label, confidence_score: normalized };
}

function buildFingerprint(payload: NormalizedExplanationPayload) {
  const narrativeStrategyVersion =
    payload.kind === "delta"
      ? ESTIMATE_DELTA_NARRATIVE_STRATEGY_VERSION
      : ESTIMATE_EXPLANATION_PROMPT_VERSION;

  return createHash("sha256")
    .update(
      JSON.stringify({
        narrative_strategy_version: narrativeStrategyVersion,
        payload,
      })
    )
    .digest("hex");
}

function toEntryDelta(entry: EstimateDiffEntry) {
  const beforeHt = entry.beforeItem?.line_total_ht_cents ?? 0;
  const afterHt = entry.afterItem?.line_total_ht_cents ?? 0;
  const beforeTtc = entry.beforeItem?.line_total_ttc_cents ?? 0;
  const afterTtc = entry.afterItem?.line_total_ttc_cents ?? 0;

  if (entry.changeType === "added") {
    return {
      deltaHtCents: afterHt,
      deltaTtcCents: afterTtc,
    };
  }

  if (entry.changeType === "removed") {
    return {
      deltaHtCents: -beforeHt,
      deltaTtcCents: -beforeTtc,
    };
  }

  return {
    deltaHtCents: afterHt - beforeHt,
    deltaTtcCents: afterTtc - beforeTtc,
  };
}

function extractTopDrivers(diffEntries: EstimateDiffEntry[]) {
  return [...diffEntries]
    .map((entry) => ({
      entry,
      delta: toEntryDelta(entry),
    }))
    .sort(
      (left, right) =>
        Math.abs(right.delta.deltaHtCents) - Math.abs(left.delta.deltaHtCents)
    )
    .slice(0, MAX_TOP_DRIVERS)
    .map(({ entry, delta }) => {
      const prefix = delta.deltaHtCents >= 0 ? "+" : "";
      return `${entry.title}: ${prefix}${formatEUR(delta.deltaHtCents)} HT`;
    });
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getDeltaDirection(deltaHtCents: number | null | undefined) {
  if (typeof deltaHtCents !== "number" || deltaHtCents === 0) {
    return "stable" as const;
  }

  return deltaHtCents > 0 ? "increase" as const : "decrease" as const;
}

function buildDeltaAmountFragment(impactSummary: EstimateExplanationImpactSummary) {
  const deltaHt = impactSummary.delta_ht_cents;
  const deltaTtc = impactSummary.delta_ttc_cents;
  const direction = getDeltaDirection(deltaHt);

  if (typeof deltaHt !== "number" || typeof deltaTtc !== "number") {
    return "Delta montant non renseigne";
  }

  if (direction === "stable") {
    return `Delta stable a ${formatEUR(0)} HT et ${formatEUR(0)} TTC`;
  }

  const trendLabel = direction === "increase" ? "Hausse globale" : "Baisse globale";
  return `${trendLabel} de ${formatEUR(Math.abs(deltaHt))} HT et ${formatEUR(
    Math.abs(deltaTtc)
  )} TTC`;
}

function buildDeltaSummaryShort(input: {
  currentVersion: string;
  compareVersion: string;
  impactSummary: EstimateExplanationImpactSummary;
}) {
  const amountFragment = buildDeltaAmountFragment(input.impactSummary);
  const primaryDriver = input.impactSummary.top_drivers[0] ?? null;
  const driverFragment = primaryDriver ? ` Driver principal: ${primaryDriver}.` : "";
  return `${input.currentVersion} vs ${input.compareVersion}: ${amountFragment}.${driverFragment}`;
}

function hasConflictingDeltaNarrative(input: {
  narrative: string;
  impactSummary: EstimateExplanationImpactSummary;
}) {
  const direction = getDeltaDirection(input.impactSummary.delta_ht_cents);
  if (direction === "stable") {
    return false;
  }

  const narrative = normalizeSearchText(input.narrative);
  const increasePattern =
    /\b(hausse|augmentation|augmente|augmentee|augmenter|en hausse|progression)\b/;
  const decreasePattern =
    /\b(baisse|diminution|reduction|reduit|reduite|baisser|en baisse)\b/;

  if (direction === "decrease") {
    return increasePattern.test(narrative);
  }

  return decreasePattern.test(narrative);
}

function extractSourceMetadataStatements(input: {
  sourceMetadata: unknown;
  facts: EstimateExplanationStatement[];
  hypotheses: EstimateExplanationStatement[];
  inferences: EstimateExplanationStatement[];
  provenance: ExplanationSourceInsert[];
}) {
  const sourceMetadata = input.sourceMetadata;
  if (!isRecord(sourceMetadata)) {
    return;
  }

  const applications = Array.isArray(sourceMetadata.applications)
    ? sourceMetadata.applications
    : [];

  applications.forEach((application) => {
    if (!isRecord(application)) {
      return;
    }

    const label = toNonEmptyString(application.label) ?? "Application IA";
    pushSource(input.provenance, {
      source_kind: "source_metadata",
      label,
      source_ref:
        toNonEmptyString(application.applied_action) ??
        toNonEmptyString(application.generated_at) ??
        null,
      confidence_score:
        typeof application.confidence === "number" ? application.confidence : null,
      source_record_table: null,
      source_record_id: null,
      metadata_json: {
        provider: "ai_structure",
      },
    });

    const buckets: Array<{
      key: "facts" | "hypotheses" | "inferences";
      target: EstimateExplanationStatement[];
    }> = [
      { key: "facts", target: input.facts },
      { key: "hypotheses", target: input.hypotheses },
      { key: "inferences", target: input.inferences },
    ];

    buckets.forEach(({ key, target }) => {
      const rawEntries = Array.isArray(application[key]) ? application[key] : [];
      rawEntries.forEach((entry) => {
        const text = toNonEmptyString(entry);
        if (!text) return;
        pushStatement(target, {
          label: text,
          source_label: label,
          confidence_score:
            typeof application.confidence === "number"
              ? application.confidence
              : null,
        });
      });
    });

    const provenanceEntries = Array.isArray(application.provenance)
      ? application.provenance
      : [];
    provenanceEntries.forEach((entry) => {
      if (!isRecord(entry)) return;
      const provenanceLabel =
        toNonEmptyString(entry.label) ?? toNonEmptyString(entry.excerpt);
      if (!provenanceLabel) return;
      pushSource(input.provenance, {
        source_kind: "source_metadata",
        label: provenanceLabel,
        source_ref: toNonEmptyString(entry.excerpt),
        confidence_score:
          typeof application.confidence === "number"
            ? application.confidence
            : null,
        source_record_table: null,
        source_record_id: null,
        metadata_json: {
          application: label,
        },
      });
    });
  });

  const genericLists: Array<{
    key: "facts" | "hypotheses" | "inferences";
    target: EstimateExplanationStatement[];
  }> = [
    { key: "facts", target: input.facts },
    { key: "hypotheses", target: input.hypotheses },
    { key: "inferences", target: input.inferences },
  ];

  genericLists.forEach(({ key, target }) => {
    const rawEntries = Array.isArray(sourceMetadata[key])
      ? sourceMetadata[key]
      : [];
    rawEntries.forEach((entry: unknown) => {
      const text = toNonEmptyString(entry);
      if (!text) return;
      pushStatement(target, {
        label: text,
        source_label: "Source IA",
        confidence_score: null,
      });
    });
  });

  const generatedComponents = Array.isArray(sourceMetadata.components)
    ? sourceMetadata.components
    : [];
  generatedComponents.forEach((component) => {
    if (!isRecord(component)) {
      return;
    }

    const label =
      toNonEmptyString(
        typeof component.designation === "string" ? component.designation : null
      ) ?? "Composant ouvrage compose";
    const sourceLabel =
      toNonEmptyString(
        typeof component.sourceLabel === "string"
          ? component.sourceLabel
          : typeof component.source_label === "string"
            ? component.source_label
            : null
      ) ?? "Snapshot ouvrage compose";

    pushSource(input.provenance, {
      source_kind: "source_metadata",
      label,
      source_ref: sourceLabel,
      confidence_score:
        typeof component.confidence === "number" ? component.confidence : null,
      source_record_table: null,
      source_record_id: null,
      metadata_json: {
        provider: "generated_ouvrage",
      },
    });
  });
}

async function getAuthenticatedExplanationContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized("Authentification requise.");
  }

  return {
    supabase,
    userId: user.id,
  };
}

async function listEstimateExplanationSourceRows(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  explanationId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_explanation_sources" as never)
    .select(ESTIMATE_EXPLANATION_SOURCES_SELECT as never)
    .eq("explanation_id" as never, input.explanationId as never)
    .order("rank" as never, { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les sources de l'explication."
    );
  }

  return (data ?? []).map((row) => sourceRowSchema.parse(row));
}

async function insertEstimateExplanationSourceRows(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  explanationId: string;
  provenance: NormalizedExplanationPayload["provenance"];
}) {
  if (input.provenance.length === 0) {
    return;
  }

  const sourceInsertPayload = input.provenance.map((source, index) => ({
    id: randomUUID(),
    explanation_id: input.explanationId,
    source_kind: source.source_kind,
    label: source.label,
    source_ref: source.source_ref,
    confidence_score: source.confidence_score,
    rank: index,
    source_record_table: source.source_record_table,
    source_record_id: source.source_record_id,
    metadata_json: source.metadata_json,
  }));

  const { error } = await input.supabase
    .from("estimate_explanation_sources" as never)
    .insert(sourceInsertPayload as never);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de persister la provenance de l'explication."
    );
  }
}

async function getActiveEstimateExplanationRow(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  versionId: string;
  lineId: string | null;
  compareVersionId: string | null;
  kind: EstimateExplanationKind;
}) {
  let query = input.supabase
    .from("estimate_explanations" as never)
    .select(ESTIMATE_EXPLANATIONS_SELECT as never)
    .eq("version_id" as never, input.versionId as never)
    .eq("explanation_kind" as never, input.kind as never)
    .is("superseded_at" as never, null);

  query =
    input.lineId === null
      ? query.is("line_id" as never, null)
      : query.eq("line_id" as never, input.lineId as never);
  query =
    input.compareVersionId === null
      ? query.is("compare_version_id" as never, null)
      : query.eq("compare_version_id" as never, input.compareVersionId as never);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'explication active.");
  }

  return data ? rowSchema.parse(data) : null;
}

function isDuplicateKeyError(error: unknown): error is { code?: string; message?: string } {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  return code === "23505" || message.includes("duplicate key");
}

async function resolveConcurrentExplanationInsert(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  versionId: string;
  lineId: string | null;
  compareVersionId: string | null;
  kind: EstimateExplanationKind;
  fingerprint: string;
  expectedSourceCount: number;
}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const activeRow = await getActiveEstimateExplanationRow({
      supabase: input.supabase,
      versionId: input.versionId,
      lineId: input.lineId,
      compareVersionId: input.compareVersionId,
      kind: input.kind,
    });

    if (!activeRow) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }

      throw conflict(
        "Une explication concurrente a ete creee, mais la nouvelle version reste introuvable."
      );
    }

    if (activeRow.snapshot_fingerprint !== input.fingerprint) {
      throw conflict("Une explication plus recente existe deja pour cette ligne.");
    }

    const sourceRows = await listEstimateExplanationSourceRows({
      supabase: input.supabase,
      explanationId: activeRow.id,
    });

    if (sourceRows.length > 0 || input.expectedSourceCount === 0 || attempt === 3) {
      return {
        row: activeRow,
        sourceRows,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
  }

  throw conflict("Une explication concurrente plus recente existe deja.");
}

function mapExplanationSnapshot(input: {
  row: EstimateExplanationRow;
  sourceRows: EstimateExplanationSourceRow[];
  includeDetail: boolean;
}) {
  const statements = statementsJsonSchema.parse(input.row.statements_json);
  const riskSignals = z
    .array(estimateExplanationRiskSignalSchema)
    .parse(input.row.risk_signals_json);
  const impactSummary = estimateExplanationImpactSummarySchema.parse(
    input.row.impact_summary_json
  );
  const provenance = input.sourceRows.map((sourceRow) =>
    estimateExplanationProvenanceSchema.parse({
      source_kind: sourceRow.source_kind,
      label: sourceRow.label,
      source_ref: sourceRow.source_ref,
      confidence_score: sourceRow.confidence_score,
    })
  );

  const snapshot = estimateExplanationSnapshotSchema.parse({
    explanation_id: input.row.id,
    kind: input.row.explanation_kind,
    version_id: input.row.version_id,
    line_id: input.row.line_id,
    compare_version_id: input.row.compare_version_id,
    summary_short: input.row.summary_short,
    summary_detail: input.includeDetail ? input.row.summary_detail : null,
    confidence_label: input.row.confidence_label,
    confidence_score: input.row.confidence_score,
    used_fallback: input.row.used_fallback,
    provider: input.row.provider,
    model: input.row.model,
    generated_at: input.row.generated_at,
    facts: statements.facts,
    hypotheses: statements.hypotheses,
    inferences: statements.inferences,
    provenance,
    risk_signals: riskSignals,
    impact_summary: impactSummary,
  });

  return snapshot;
}

function buildFallbackNarrative(input: {
  kind: EstimateExplanationKind;
  summaryContext: Record<string, unknown>;
  statements: StatementBuckets;
  impactSummary: EstimateExplanationImpactSummary;
}) {
  if (input.kind === "price") {
    const lineLabel = toNonEmptyString(input.summaryContext.line_label) ?? "cette ligne";
    const currentPrice = input.impactSummary.current_amount_ht_cents;
    const amountFragment =
      typeof currentPrice === "number"
        ? `Montant actuel ${formatEUR(currentPrice)} HT`
        : "Montant actuel non renseigne";
    const factFragment =
      input.statements.facts[0]?.label ?? "Aucune preuve factuelle detaillee disponible";
    const detail = [
      `${lineLabel}: ${amountFragment}.`,
      `Faits: ${
        input.statements.facts.length > 0
          ? input.statements.facts.map((entry) => entry.label).join(" · ")
          : "aucun"
      }.`,
      `Hypotheses: ${
        input.statements.hypotheses.length > 0
          ? input.statements.hypotheses.map((entry) => entry.label).join(" · ")
          : "aucune"
      }.`,
      `Inferences: ${
        input.statements.inferences.length > 0
          ? input.statements.inferences.map((entry) => entry.label).join(" · ")
          : "aucune"
      }.`,
    ].join(" ");

    return {
      summary_short: `${lineLabel}: ${amountFragment}. ${factFragment}.`,
      summary_detail: detail,
    };
  }

  const currentVersion =
    toNonEmptyString(input.summaryContext.current_version_label) ?? "version courante";
  const compareVersion =
    toNonEmptyString(input.summaryContext.compare_version_label) ?? "version comparee";
  const deltaFragment = buildDeltaAmountFragment(input.impactSummary);
  const drivers = input.impactSummary.top_drivers;
  const driverDetailFragment =
    drivers.length === 1
      ? `Une seule ligne explique le delta: ${drivers[0]}.`
      : drivers.length > 1
        ? `Principaux drivers: ${drivers.join(" · ")}.`
        : "Aucun poste dominant detecte.";
  const detail = [
    `${currentVersion} vs ${compareVersion}: ${deltaFragment}.`,
    driverDetailFragment,
    `Faits: ${
      input.statements.facts.length > 0
        ? input.statements.facts.map((entry) => entry.label).join(" · ")
        : "aucun"
    }.`,
    `Hypotheses: ${
      input.statements.hypotheses.length > 0
        ? input.statements.hypotheses.map((entry) => entry.label).join(" · ")
        : "aucune"
    }.`,
    `Inferences: ${
      input.statements.inferences.length > 0
        ? input.statements.inferences.map((entry) => entry.label).join(" · ")
        : "aucune"
      }.`,
  ].join(" ");

  return {
    summary_short: buildDeltaSummaryShort({
      currentVersion,
      compareVersion,
      impactSummary: input.impactSummary,
    }),
    summary_detail: detail,
  };
}

function buildNarrativePrompt(input: NormalizedExplanationPayload) {
  return [
    "ROLE",
    "Tu rediges une explication de prix/de delta pour un devis BTP.",
    "",
    "CONTRAINTES",
    "1. Ne jamais inventer de preuve ou de source.",
    "2. Distinguer clairement faits, hypotheses et inferences.",
    "3. Signaler l'incertitude quand des hypotheses ou inferences dominent.",
    "4. Rester explicatif et lisible par un humain, sans ton commercial.",
    "5. Retourner uniquement un JSON valide conforme au schema.",
    "",
    "DONNEES NORMALISEES",
    JSON.stringify(input),
  ].join("\n");
}

async function generateNarrative(input: NormalizedExplanationPayload) {
  if (input.kind === "delta") {
    const fallback = buildFallbackNarrative({
      kind: input.kind,
      summaryContext: input.summary_context,
      statements: input.statements,
      impactSummary: input.impact_summary,
    });

    return {
      narrative: fallback,
      usedFallback: true,
      provider: "fallback",
      model: null,
    };
  }

  try {
    const result = await callGeminiStructured<z.infer<typeof explanationNarrativeSchema>>({
      prompt: buildNarrativePrompt(input),
      schema: explanationNarrativeSchema,
      thinkingLevel: ESTIMATE_EXPLANATION_THINKING_LEVEL,
      context: {
        model: ESTIMATE_EXPLANATION_MODEL,
        promptVersion: ESTIMATE_EXPLANATION_PROMPT_VERSION,
      },
    });

    const summaryContext =
      input.compare_version_id !== null
        ? {
            currentVersion:
              toNonEmptyString(input.summary_context.current_version_label) ??
              "version courante",
            compareVersion:
              toNonEmptyString(input.summary_context.compare_version_label) ??
              "version comparee",
          }
        : null;

    if (
      summaryContext &&
      hasConflictingDeltaNarrative({
        narrative: `${result.data.summary_short} ${result.data.summary_detail}`,
        impactSummary: input.impact_summary,
      })
    ) {
      const fallback = buildFallbackNarrative({
        kind: input.kind,
        summaryContext: input.summary_context,
        statements: input.statements,
        impactSummary: input.impact_summary,
      });

      return {
        narrative: fallback,
        usedFallback: true,
        provider: "fallback",
        model: null,
        failureMessage:
          "Narration delta ignoree car contradictoire avec les montants du diff.",
      };
    }

    return {
      narrative:
        summaryContext
          ? {
              ...result.data,
              summary_short: buildDeltaSummaryShort({
                currentVersion: summaryContext.currentVersion,
                compareVersion: summaryContext.compareVersion,
                impactSummary: input.impact_summary,
              }),
            }
          : result.data,
      usedFallback: false,
      provider: "gemini",
      model: result.model,
    };
  } catch (error) {
    const fallback = buildFallbackNarrative({
      kind: input.kind,
      summaryContext: input.summary_context,
      statements: input.statements,
      impactSummary: input.impact_summary,
    });

    return {
      narrative: fallback,
      usedFallback: true,
      provider: "fallback",
      model: null,
      failureMessage: error instanceof Error ? error.message : "Generation indisponible.",
    };
  }
}

async function persistExplanationSnapshot(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  projectId: string;
  payload: NormalizedExplanationPayload;
  fingerprint: string;
  narrative: z.infer<typeof explanationNarrativeSchema>;
  usedFallback: boolean;
  provider: string;
  model: string | null;
  existingActiveRow: EstimateExplanationRow | null;
  failureMessage?: string;
}) {
  const supersedeTimestamp = new Date().toISOString();
  if (input.existingActiveRow) {
    const { error: supersedeError } = await input.supabase
      .from("estimate_explanations" as never)
      .update({
        superseded_at: supersedeTimestamp,
      } as never)
      .eq("id" as never, input.existingActiveRow.id as never);

    if (supersedeError) {
      throw mapSupabaseError(
        supersedeError,
        "Impossible de superseder l'explication precedente."
      );
    }
  }

  const insertPayload = {
    tenant_id: null,
    project_id: input.projectId,
    version_id: input.payload.version_id,
    line_id: input.payload.line_id,
    compare_version_id: input.payload.compare_version_id,
    requested_by: input.userId,
    explanation_kind: input.payload.kind,
    snapshot_fingerprint: input.fingerprint,
    summary_short: input.narrative.summary_short,
    summary_detail: input.narrative.summary_detail,
    confidence_label: input.payload.confidence_label,
    confidence_score: input.payload.confidence_score,
    used_fallback: input.usedFallback,
    provider: input.provider,
    model: input.model,
    statements_json: input.payload.statements,
    risk_signals_json: input.payload.risk_signals,
    impact_summary_json: input.payload.impact_summary,
    metadata_json: {
      prompt_version: ESTIMATE_EXPLANATION_PROMPT_VERSION,
      summary_context: input.payload.summary_context,
      failure_message: input.failureMessage ?? null,
    },
    generated_at: new Date().toISOString(),
    superseded_at: null,
    superseded_by_explanation_id: null,
  };

  const insertResult = await input.supabase
    .from("estimate_explanations" as never)
    .insert(insertPayload as never)
    .select(ESTIMATE_EXPLANATIONS_SELECT as never)
    .single();
  const insertedData = insertResult.data as unknown;
  const insertError = insertResult.error as unknown;

  if (insertError) {
    if (isDuplicateKeyError(insertError)) {
      return resolveConcurrentExplanationInsert({
        supabase: input.supabase,
        versionId: input.payload.version_id,
        lineId: input.payload.line_id,
        compareVersionId: input.payload.compare_version_id,
        kind: input.payload.kind,
        fingerprint: input.fingerprint,
        expectedSourceCount: input.payload.provenance.length,
      });
    }

    throw mapSupabaseError(
      insertError as never,
      "Impossible de persister l'explication."
    );
  }

  if (!insertedData) {
    throw internalError("L'explication persistee est introuvable apres insertion.");
  }

  const insertedRow = rowSchema.parse(insertedData);

  if (input.existingActiveRow) {
    const { error: linkError } = await input.supabase
      .from("estimate_explanations" as never)
      .update({
        superseded_by_explanation_id: insertedRow.id,
      } as never)
      .eq("id" as never, input.existingActiveRow.id as never);

    if (linkError) {
      throw mapSupabaseError(
        linkError,
        "Impossible de finaliser la supersession de l'explication precedente."
      );
    }
  }

  await insertEstimateExplanationSourceRows({
    supabase: input.supabase,
    explanationId: insertedRow.id,
    provenance: input.payload.provenance,
  });

  const sourceRows = await listEstimateExplanationSourceRows({
    supabase: input.supabase,
    explanationId: insertedRow.id,
  });

  return {
    row: insertedRow,
    sourceRows,
  };
}

async function fetchTakeoffArtifacts(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  versionId: string;
  lineId: string;
  sourceJobId: string | null;
}) {
  if (!input.sourceJobId) {
    return {
      suggestion: null,
      suggestionSources: [] as TakeoffPriceSuggestionSourceRow[],
      evidences: [] as EstimateLineEvidenceRow[],
      riskAlerts: [] as EstimateRiskAlertRow[],
    };
  }

  const [suggestionResult, evidenceResult, riskAlertResult] = await Promise.all([
    input.supabase
      .from("takeoff_price_suggestions" as never)
      .select(TAKEOFF_PRICE_SUGGESTIONS_SELECT as never)
      .eq("version_id" as never, input.versionId as never)
      .eq("takeoff_job_id" as never, input.sourceJobId as never)
      .eq("estimate_item_id" as never, input.lineId as never)
      .is("superseded_at" as never, null)
      .maybeSingle(),
    input.supabase
      .from("estimate_line_evidences" as never)
      .select(ESTIMATE_LINE_EVIDENCES_SELECT as never)
      .eq("version_id" as never, input.versionId as never)
      .eq("takeoff_job_id" as never, input.sourceJobId as never)
      .eq("estimate_item_id" as never, input.lineId as never)
      .is("invalidated_at" as never, null)
      .order("created_at" as never, { ascending: true }),
    input.supabase
      .from("estimate_risk_alerts" as never)
      .select(ESTIMATE_RISK_ALERTS_SELECT as never)
      .eq("version_id" as never, input.versionId as never)
      .eq("takeoff_job_id" as never, input.sourceJobId as never)
      .eq("line_id" as never, input.lineId as never)
      .eq("is_active" as never, true as never),
  ]);

  if (suggestionResult.error) {
    throw mapSupabaseError(
      suggestionResult.error,
      "Impossible de charger la suggestion de prix."
    );
  }
  if (evidenceResult.error) {
    throw mapSupabaseError(evidenceResult.error, "Impossible de charger les preuves.");
  }
  if (riskAlertResult.error) {
    throw mapSupabaseError(
      riskAlertResult.error,
      "Impossible de charger les signaux de risque."
    );
  }

  const suggestion = suggestionResult.data
    ? priceSuggestionRowSchema.parse(suggestionResult.data)
    : null;

  let suggestionSources: TakeoffPriceSuggestionSourceRow[] = [];
  if (suggestion) {
    const suggestionSourcesResult = await input.supabase
      .from("takeoff_price_suggestion_sources" as never)
      .select(TAKEOFF_PRICE_SUGGESTION_SOURCES_SELECT as never)
      .eq("suggestion_id" as never, suggestion.id as never)
      .order("rank" as never, { ascending: true });

    if (suggestionSourcesResult.error) {
      throw mapSupabaseError(
        suggestionSourcesResult.error,
        "Impossible de charger les sources de la suggestion de prix."
      );
    }

    suggestionSources = (suggestionSourcesResult.data ?? []).map((row) =>
      priceSuggestionSourceRowSchema.parse(row)
    );
  }

  return {
    suggestion,
    suggestionSources,
    evidences: (evidenceResult.data ?? []).map((row) => evidenceRowSchema.parse(row)),
    riskAlerts: (riskAlertResult.data ?? []).map((row) => riskAlertRowSchema.parse(row)),
  };
}

function normalizePriceExplanationPayload(input: {
  line: EstimateExplanationVersionDetails["items"][number];
  version: EstimateExplanationVersionDetails["version"];
  versionLabel: string;
  suggestion: TakeoffPriceSuggestionRow | null;
  suggestionSources: TakeoffPriceSuggestionSourceRow[];
  evidences: EstimateLineEvidenceRow[];
  riskAlerts: EstimateRiskAlertRow[];
}) {
  const facts: EstimateExplanationStatement[] = [];
  const hypotheses: EstimateExplanationStatement[] = [];
  const inferences: EstimateExplanationStatement[] = [];
  const provenance: ExplanationSourceInsert[] = [];
  const riskSignals: EstimateExplanationRiskSignal[] = [];

  const lineLabel = toNonEmptyString(input.line.title) ?? "Ligne du devis";
  pushStatement(facts, {
    label: `Prix unitaire actuel ${formatEUR(input.line.pu_ht_cents ?? 0)} HT`,
    source_label: lineLabel,
    confidence_score: 1,
  });
  pushStatement(facts, {
    label: `Montant ligne ${formatEUR(input.line.line_total_ht_cents ?? 0)} HT / ${formatEUR(input.line.line_total_ttc_cents ?? 0)} TTC`,
    source_label: lineLabel,
    confidence_score: 1,
  });

  if (typeof input.version.margin_bp === "number") {
    pushStatement(facts, {
      label: `Marge configuree ${input.version.margin_bp / 100}%`,
      source_label: input.versionLabel,
      confidence_score: 1,
    });
  }

  pushSource(provenance, {
    source_kind: "estimate_item",
    label: lineLabel,
    source_ref: input.versionLabel,
    confidence_score: 1,
    source_record_table: "estimate_items",
    source_record_id: input.line.id,
    metadata_json: {
      item_type: input.line.item_type,
    },
  });

  const sourceReference = formatPageReference(
    input.line.source_file_name,
    input.line.source_page
  );
  if (sourceReference) {
    pushStatement(facts, {
      label: `Origine document ${sourceReference}`,
      source_label: input.line.source_provider ?? "source",
      confidence_score: 0.9,
    });
  }

  if (input.suggestion) {
    pushStatement(facts, {
      label: `Suggestion persistante ${formatEUR(input.suggestion.target_cents)} HT avec plage ${formatEUR(input.suggestion.low_cents)} - ${formatEUR(input.suggestion.high_cents)}`,
      source_label: "Suggestion de prix",
      confidence_score: input.suggestion.confidence_score,
    });
    pushStatement(inferences, {
      label: input.suggestion.justification,
      source_label: "Suggestion de prix",
      confidence_score: input.suggestion.confidence_score,
    });
    pushSource(provenance, {
      source_kind: "takeoff_price_suggestion",
      label: "Suggestion de prix active",
      source_ref: input.suggestion.status,
      confidence_score: input.suggestion.confidence_score,
      source_record_table: "takeoff_price_suggestions",
      source_record_id: input.suggestion.id,
      metadata_json: {
        confidence_label: input.suggestion.confidence_label,
      },
    });
  }

  input.suggestionSources.forEach((source) => {
    const target =
      source.kind === "fact"
        ? facts
        : source.kind === "hypothesis"
          ? hypotheses
          : inferences;

    pushStatement(target, {
      label: `${source.label} (${formatEUR(source.price_cents)} HT)`,
      source_label: source.source_ref,
      confidence_score: source.confidence_score,
    });
    pushSource(provenance, {
      source_kind: `takeoff_price_source:${source.source_kind}`,
      label: source.label,
      source_ref: source.source_ref,
      confidence_score: source.confidence_score,
      source_record_table: source.source_record_table,
      source_record_id: source.source_record_id,
      metadata_json: {
        price_cents: source.price_cents,
        freshness_label: source.freshness_label,
        is_outlier: source.is_outlier,
      },
    });
  });

  input.evidences.forEach((evidence) => {
    const target =
      evidence.evidence_kind === "fact"
        ? facts
        : evidence.evidence_kind === "hypothesis"
          ? hypotheses
          : inferences;
    const reference = formatPageReference(
      evidence.source_file_name,
      evidence.source_page
    );
    pushStatement(target, {
      label: reference ? `${evidence.label} (${reference})` : evidence.label,
      source_label: evidence.source_label,
      confidence_score: evidence.confidence_score,
    });
    if (evidence.note) {
      pushStatement(target, {
        label: evidence.note,
        source_label: evidence.label,
        confidence_score: evidence.confidence_score,
      });
    }
    pushSource(provenance, {
      source_kind: `takeoff_evidence:${evidence.evidence_type}`,
      label: evidence.label,
      source_ref: evidence.source_label,
      confidence_score: evidence.confidence_score,
      source_record_table: evidence.source_record_table,
      source_record_id: evidence.source_record_id,
      metadata_json: {
        evidence_kind: evidence.evidence_kind,
        evidence_type: evidence.evidence_type,
      },
    });
  });

  input.riskAlerts.forEach((alert) => {
    const reason = Array.isArray(alert.reason_labels)
      ? alert.reason_labels.join(" · ")
      : null;
    const riskLabel = reason
      ? `${alert.scope_label}: ${reason}`
      : `${alert.scope_label}: ${alert.cause_code}`;
    riskSignals.push(
      estimateExplanationRiskSignalSchema.parse({
        label: riskLabel,
        severity: alert.severity,
        basis: "fact",
        source_label: "Radar risque",
      })
    );
    pushSource(provenance, {
      source_kind: "estimate_risk_alert",
      label: alert.scope_label,
      source_ref: alert.cause_code,
      confidence_score: null,
      source_record_table: "estimate_risk_alerts",
      source_record_id: alert.id,
      metadata_json: {
        severity: alert.severity,
      },
    });
  });

  extractSourceMetadataStatements({
    sourceMetadata: input.line.source_metadata,
    facts,
    hypotheses,
    inferences,
    provenance,
  });

  const confidence = buildConfidence({
    facts: facts.length,
    hypotheses: hypotheses.length,
    inferences: inferences.length,
    provenance: provenance.length,
    riskSignals,
  });

  return {
    kind: "price" as const,
    version_id: input.version.id,
    line_id: input.line.id,
    compare_version_id: null,
    summary_context: {
      line_label: lineLabel,
      version_label: input.versionLabel,
    },
    statements: {
      facts,
      hypotheses,
      inferences,
    },
    provenance,
    risk_signals: riskSignals,
    impact_summary: estimateExplanationImpactSummarySchema.parse({
      current_amount_ht_cents: input.line.line_total_ht_cents ?? null,
      current_amount_ttc_cents: input.line.line_total_ttc_cents ?? null,
      current_margin_bp: input.version.margin_bp ?? null,
      current_margin_multiplier: input.version.margin_multiplier ?? null,
      top_drivers: [],
    }),
    ...confidence,
  } satisfies NormalizedExplanationPayload;
}

function normalizeDeltaExplanationPayload(input: {
  current: EstimateExplanationVersionDetails;
  previous: EstimateExplanationVersionDetails;
}) {
  const facts: EstimateExplanationStatement[] = [];
  const hypotheses: EstimateExplanationStatement[] = [];
  const inferences: EstimateExplanationStatement[] = [];
  const provenance: ExplanationSourceInsert[] = [];

  const diff = buildEstimateDiff({
    previous: input.previous as EstimateVersionDetailsForDiff,
    current: input.current as EstimateVersionDetailsForDiff,
  });
  const currentVersionLabel = formatVersionLabel(input.current.version);
  const previousVersionLabel = formatVersionLabel(input.previous.version);
  const topDrivers = extractTopDrivers(diff.entries);
  const topDriverEntry = [...diff.entries]
    .map((entry) => ({
      entry,
      delta: toEntryDelta(entry),
    }))
    .sort(
      (left, right) =>
        Math.abs(right.delta.deltaHtCents) - Math.abs(left.delta.deltaHtCents)
    )[0] ?? null;

  pushStatement(facts, {
    label: `${diff.summary.addedCount} ajouts, ${diff.summary.removedCount} suppressions, ${diff.summary.modifiedCount} modifications`,
    source_label: "Diff versions",
    confidence_score: 1,
  });
  pushStatement(facts, {
      label: `Delta total ${diff.summary.deltaHtCents >= 0 ? "+" : ""}${formatEUR(diff.summary.deltaHtCents)} HT et ${diff.summary.deltaTtcCents >= 0 ? "+" : ""}${formatEUR(diff.summary.deltaTtcCents)} TTC`,
      source_label: "Diff versions",
      confidence_score: 1,
  });

  if (
    diff.summary.addedCount === 0 &&
    diff.summary.removedCount === 0 &&
    diff.summary.modifiedCount === 1 &&
    topDriverEntry &&
    topDriverEntry.delta.deltaHtCents === diff.summary.deltaHtCents &&
    topDriverEntry.delta.deltaTtcCents === diff.summary.deltaTtcCents
  ) {
    const trendLabel =
      getDeltaDirection(diff.summary.deltaHtCents) === "increase"
        ? "hausse"
        : getDeltaDirection(diff.summary.deltaHtCents) === "decrease"
          ? "baisse"
          : "stabilite";
    pushStatement(facts, {
      label: `Une seule ligne explique le delta: ${topDriverEntry.entry.title} (${trendLabel} de ${formatEUR(Math.abs(diff.summary.deltaHtCents))} HT)`,
      source_label: "Diff versions",
      confidence_score: 1,
    });
  }

  if (typeof input.current.version.margin_bp === "number") {
    pushStatement(facts, {
      label: `Marge actuelle ${input.current.version.margin_bp / 100}%`,
      source_label: currentVersionLabel,
      confidence_score: 1,
    });
  }

  if (typeof input.previous.version.margin_bp === "number") {
    pushStatement(facts, {
      label: `Marge comparee ${input.previous.version.margin_bp / 100}%`,
      source_label: previousVersionLabel,
      confidence_score: 1,
    });
  }

  topDrivers.forEach((driver) => {
    pushStatement(inferences, {
      label: `Driver principal ${driver}`,
      source_label: "Diff versions",
      confidence_score: 0.85,
    });
  });

  pushSource(provenance, {
    source_kind: "estimate_version",
    label: currentVersionLabel,
    source_ref: input.current.version.id,
    confidence_score: 1,
    source_record_table: "estimate_versions",
    source_record_id: input.current.version.id,
    metadata_json: {
      role: "current",
    },
  });
  pushSource(provenance, {
    source_kind: "estimate_version",
    label: previousVersionLabel,
    source_ref: input.previous.version.id,
    confidence_score: 1,
    source_record_table: "estimate_versions",
    source_record_id: input.previous.version.id,
    metadata_json: {
      role: "previous",
    },
  });

  [...diff.entries]
    .sort(
      (left, right) =>
        Math.abs(toEntryDelta(right).deltaHtCents) -
        Math.abs(toEntryDelta(left).deltaHtCents)
    )
    .slice(0, MAX_TOP_DRIVERS)
    .forEach((entry) => {
      const delta = toEntryDelta(entry);
      pushSource(provenance, {
        source_kind: "estimate_diff_entry",
        label: entry.title,
        source_ref: `${entry.changeType}:${delta.deltaHtCents}`,
        confidence_score: 1,
        source_record_table: "estimate_items",
        source_record_id: entry.afterItem?.id ?? entry.beforeItem?.id ?? null,
        metadata_json: {
          change_type: entry.changeType,
          entity_type: entry.entityType,
          delta_ht_cents: delta.deltaHtCents,
          delta_ttc_cents: delta.deltaTtcCents,
        },
      });
    });

  const marginBpDelta =
    typeof input.current.version.margin_bp === "number" &&
    typeof input.previous.version.margin_bp === "number"
      ? input.current.version.margin_bp - input.previous.version.margin_bp
      : null;

  if (marginBpDelta !== null && marginBpDelta !== 0) {
    pushStatement(facts, {
      label: `Delta de marge configuree ${(marginBpDelta / 100).toFixed(2)} points`,
      source_label: "Parametres de version",
      confidence_score: 1,
    });
  }

  const confidence = buildConfidence({
    facts: facts.length,
    hypotheses: hypotheses.length,
    inferences: inferences.length,
    provenance: provenance.length,
    riskSignals: [],
  });

  return {
    kind: "delta" as const,
    version_id: input.current.version.id,
    line_id: null,
    compare_version_id: input.previous.version.id,
    summary_context: {
      current_version_label: currentVersionLabel,
      compare_version_label: previousVersionLabel,
    },
    statements: {
      facts,
      hypotheses,
      inferences,
    },
    provenance,
    risk_signals: [],
    impact_summary: estimateExplanationImpactSummarySchema.parse({
      delta_ht_cents: diff.summary.deltaHtCents,
      delta_ttc_cents: diff.summary.deltaTtcCents,
      current_margin_bp: input.current.version.margin_bp ?? null,
      compare_margin_bp: input.previous.version.margin_bp ?? null,
      margin_bp_delta: marginBpDelta,
      current_margin_multiplier: input.current.version.margin_multiplier ?? null,
      compare_margin_multiplier: input.previous.version.margin_multiplier ?? null,
      top_drivers: topDrivers,
    }),
    ...confidence,
  } satisfies NormalizedExplanationPayload;
}

async function resolveExplanationSnapshot(input: {
  kind: EstimateExplanationKind;
  versionId: string;
  lineId: string | null;
  compareVersionId: string | null;
  includeDetail: boolean;
  current: EstimateExplanationVersionDetails;
  previous?: EstimateExplanationVersionDetails;
}) {
  const { supabase, userId } = await getAuthenticatedExplanationContext();
  const projectId = input.current.version.project_id;
  const existingActiveRow = await getActiveEstimateExplanationRow({
    supabase,
    versionId: input.versionId,
    lineId: input.lineId,
    compareVersionId: input.compareVersionId,
    kind: input.kind,
  });

  let normalizedPayload: NormalizedExplanationPayload;

  if (input.kind === "price") {
    const line = input.current.items.find((item) => item.id === input.lineId);
    if (!line) {
      throw notFound("Ligne de devis introuvable.");
    }
    if (line.item_type !== "line") {
      throw badRequest("L'explication de prix ne s'applique qu'aux lignes.");
    }

    const takeoffArtifacts = await fetchTakeoffArtifacts({
      supabase,
      versionId: input.versionId,
      lineId: line.id,
      sourceJobId: toNonEmptyString(line.source_job_id),
    });

    normalizedPayload = normalizePriceExplanationPayload({
      line,
      version: input.current.version,
      versionLabel: formatVersionLabel(input.current.version),
      suggestion: takeoffArtifacts.suggestion,
      suggestionSources: takeoffArtifacts.suggestionSources,
      evidences: takeoffArtifacts.evidences,
      riskAlerts: takeoffArtifacts.riskAlerts,
    });
  } else {
    if (!input.previous || !input.compareVersionId) {
      throw badRequest("Version de comparaison requise.");
    }
    normalizedPayload = normalizeDeltaExplanationPayload({
      current: input.current,
      previous: input.previous,
    });
  }

  const fingerprint = buildFingerprint(normalizedPayload);

  if (
    existingActiveRow &&
    existingActiveRow.snapshot_fingerprint === fingerprint
  ) {
    let sourceRows = await listEstimateExplanationSourceRows({
      supabase,
      explanationId: existingActiveRow.id,
    });

    if (sourceRows.length === 0 && normalizedPayload.provenance.length > 0) {
      await insertEstimateExplanationSourceRows({
        supabase,
        explanationId: existingActiveRow.id,
        provenance: normalizedPayload.provenance,
      });
      sourceRows = await listEstimateExplanationSourceRows({
        supabase,
        explanationId: existingActiveRow.id,
      });
    }

    return mapExplanationSnapshot({
      row: existingActiveRow,
      sourceRows,
      includeDetail: input.includeDetail,
    });
  }

  const generated = await generateNarrative(normalizedPayload);

  const persisted = await persistExplanationSnapshot({
    supabase,
    userId,
    projectId,
    payload: normalizedPayload,
    fingerprint,
    narrative: generated.narrative,
    usedFallback: generated.usedFallback,
    provider: generated.provider,
    model: generated.model,
    existingActiveRow,
    failureMessage:
      "failureMessage" in generated ? generated.failureMessage : undefined,
  });

  return mapExplanationSnapshot({
    row: persisted.row,
    sourceRows: persisted.sourceRows,
    includeDetail: input.includeDetail,
  });
}

export async function getEstimateLineExplanation(input: {
  versionId: string;
  lineId: string;
  includeDetail: boolean;
}): Promise<EstimateExplanationSnapshot> {
  const current = await getEstimateVersionDetails(input.versionId);

  return resolveExplanationSnapshot({
    kind: "price",
    versionId: input.versionId,
    lineId: input.lineId,
    compareVersionId: null,
    includeDetail: input.includeDetail,
    current,
  });
}

export async function getEstimateDeltaExplanation(input: {
  versionId: string;
  compareVersionId: string;
  includeDetail: boolean;
}): Promise<EstimateExplanationSnapshot> {
  if (input.versionId === input.compareVersionId) {
    throw badRequest("La comparaison doit cibler une autre version.");
  }

  const [current, previous] = await Promise.all([
    getEstimateVersionDetails(input.versionId),
    getEstimateVersionDetails(input.compareVersionId),
  ]);

  if (
    current.version.tenant_id !== previous.version.tenant_id ||
    current.version.project_id !== previous.version.project_id
  ) {
    throw notFound("Version de comparaison introuvable.");
  }

  return resolveExplanationSnapshot({
    kind: "delta",
    versionId: input.versionId,
    lineId: null,
    compareVersionId: input.compareVersionId,
    includeDetail: input.includeDetail,
    current,
    previous,
  });
}
