import "server-only";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffHypothesisCause } from "@/lib/takeoff/hypothesis";
import { takeoffItemAnswersRefusal, type TakeoffItemAnswersRefusal } from "@/lib/takeoff/item-answers";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { buildLevelCRunMetricRows } from "@/lib/takeoff/level-c-chunk-metrics";
import {
  POSTE_EXCHANGE_PROMPT_VERSION,
  POSTE_EXCHANGE_SCHEMA_VERSION,
  type PosteAnswerOutcome,
  type PosteObservationMethod,
} from "@/lib/takeoff/poste-exchange";
import type { PosteObservationRole, PostePlanReading, PosteReasonCode } from "@/lib/takeoff/poste-exchange-merge";
import type { Poste } from "@/lib/takeoff/poste-list";
import { posteVectorKey, type PosteUnitReading } from "@/lib/takeoff/poste-reading";
import { publicTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import type { Supabase } from "@/lib/takeoff/processing-context";
import { writableRuleInputs } from "@/lib/takeoff/rules/contracts";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import { isTakeoffRulesEnabled } from "@/lib/takeoff/rules/recompute-server";
import type { TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import { buildTakeoffVectorPersistence } from "@/lib/takeoff/vectors/worker-persistence-server";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

/**
 * The input of the publication command of one unit of the second measuring order (lot 4 PR 3a's command, its contract in
 * addendum 1): for a job that read its plan against the sealed list, the answers of every item of the unit's scope and
 * the job's end, written in one transaction by the worker under its lease. The command reads the request, the unit and
 * the sealed list revision itself; it is given only what the reading produced, and what today's end of a job takes.
 */
export type TakeoffItemAnswerObservation = {
  page: number;
  evidence: string;
  method: PosteObservationMethod | "vector_reading";
  confidence: number;
  quantity: number | null;
  unit: string | null;
  measurement_basis: string | null;
  role: PosteObservationRole;
  source: "model" | "vector";
  chunk_id: string | null;
  /** A vector observation: the vector row (`p_vector.items[].id`) this publication inserts. */
  vector_key: string | null;
  /** A contribution: the positive `takeoff_items` row (`p_items[].id`) the existing readers use. None for any other role. */
  takeoff_item_id: string | null;
};

export type TakeoffItemAnswer = {
  item_id: string;
  outcome: PosteAnswerOutcome;
  /** Ordered: the first is the primary reason. Empty only for a measured answer. */
  reasons: Array<{ code: PosteReasonCode; by: "model" | "worker"; text: string | null; chunk_id: string | null }>;
  searched_pages: number[];
  unreadable_pages: number[];
  /** Measured only: the sum of its contributions. */
  quantity: { value: number; unit: string } | null;
  /** Uncertain only: the value its readings suggest. */
  candidate: { value: number; unit: string } | null;
  observations: TakeoffItemAnswerObservation[];
};

export type TakeoffItemAnswersPublication = {
  p_job_id: string;
  p_lease_token: string;
  p_completed_at: string;
  p_model: string;
  p_prompt_version: typeof POSTE_EXCHANGE_PROMPT_VERSION;
  p_exchange: { schema_version: typeof POSTE_EXCHANGE_SCHEMA_VERSION; prompt_version: typeof POSTE_EXCHANGE_PROMPT_VERSION };
  /** The unit's original pages: every answer's searched and unreadable pages together cover exactly these. */
  p_unit_pages: number[];
  /** Exactly one per item of the unit's sealed scope, in the list's order. */
  p_answers: TakeoffItemAnswer[];
  /** Findings outside the list: also in `p_result.warnings` as `POSTE_HORS_LISTE`, never an item or an answer. */
  p_findings: Array<{ page: number; designation: string; evidence: string; chunk_id: string }>;
  /** As `finalize_local_takeoff_result` takes it: the result row, its usage and its run metrics. */
  p_result: {
    extracted_json: Record<string, unknown>;
    warnings: Array<{ code: string; message: string; severity: "info" | "warning" | "error" }>;
    tables: [];
    provider_meta: Record<string, unknown>;
    confidence: null;
    token_count: number;
    cost_cents: number;
    duration_ms: number;
    job_duration_ms: number;
    run_metrics: ReturnType<typeof buildLevelCRunMetricRows>;
  };
  /** The contributions' positive rows, inserted as today's items (their ids are those of the contributions' links). */
  p_items: Array<{
    id: string; designation: string; quantity: number; unit: string; confidence: number | null; evidence: string | null;
    source_file_name: string | null; source_page: number; metadata: Record<string, unknown>; is_excluded: false;
    exclusion_reason: null; rules_stale: boolean;
  }>;
  /** The vector pages, rows and geometries as today, every row excluded and none selected (`choices` empty). */
  p_vector?: Omit<ReturnType<typeof buildTakeoffVectorPersistence>, "choices"> & { choices: [] };
};

/** The findings outside the list a publication keeps at most (the command's own bound). */
export const TAKEOFF_ITEM_ANSWERS_MAX_FINDINGS = 2_000;

/** A finding outside the list as the result's warning: one line, bounded as a warning is. */
function findingWarning(finding: { page: number; designation: string; evidence: string }) {
  return { code: "POSTE_HORS_LISTE", severity: "info" as const,
    message: `Page ${finding.page} : ${finding.designation} — ${finding.evidence}`.slice(0, 500) };
}

/**
 * The command's input, built once from the reading: one answer per item in the list's order; each contribution of a
 * measured answer becomes a positive row of `takeoff_items` (as the first format's items: rule inputs when the rules are
 * on, its plan file as its document) and points to it; candidates and alternatives create no row; each vector
 * observation names the vector row this publication inserts, and no vector reading is ever selected as a source.
 * A measure that would be an hypothesis (`takeoffHypothesisCause`, the insert trigger's own rule: the affaire's objective
 * is an estimate, or the rules class a reading as something a plan cannot show) is never a contribution: its answer is
 * uncertain with that reason, its total a candidate value, and it creates no row (the command refuses a contribution
 * whose row the trigger excludes, after the calls were paid).
 */
export function buildTakeoffItemAnswersPublication(input: {
  job: Pick<TakeoffJobProcessingRow, "id" | "tenant_id" | "processing_lease_token" | "preparation_snapshot">;
  items: readonly Poste[];
  list: { revisionId: string; revision: number; itemCount: number };
  reading: PosteUnitReading;
  plan: PostePlanReading;
  planFile: Extract<TakeoffSourceDocumentRef, { kind: "plan_file" }>;
  fileName: string;
  mimeType: string;
  vectorOutcomes: readonly VectorPageOutcome[];
  runMetrics: ReturnType<typeof buildLevelCRunMetricRows>;
  model: string;
  completedAt: Date;
  totalDurationMs: number;
}): TakeoffItemAnswersPublication {
  const withRules = isTakeoffRulesEnabled();
  const labels = new Map(input.items.map((item) => [item.id, item.label]));
  const withVectors = input.vectorOutcomes.some((outcome) => outcome.record);
  // No vector reading is ever selected as a source in the second order: `choices` stays empty.
  const vector = withVectors ? { ...buildTakeoffVectorPersistence(input.vectorOutcomes, []), choices: [] as [] } : undefined;
  // The vector rows, in the order the persistence builds them (each page with a reading, each of its quantities).
  const vectorRows = new Map<string, string>();
  if (vector) {
    let next = 0;
    for (const outcome of input.vectorOutcomes) {
      if (!outcome.record) continue;
      outcome.items.forEach((_, index) => {
        const row = vector.items[next++];
        if (outcome.document.kind === "plan_file") vectorRows.set(posteVectorKey(outcome.document.plan_file_id, outcome.page, index), row.id);
      });
    }
    if (next !== vector.items.length) throw new Error("The vector rows do not match the vector readings.");
  }
  const items: TakeoffItemAnswersPublication["p_items"] = [];
  // As the first format's worker writes it (exchange-normalization.ts): the objective « estimate » makes every quantity an
  // estimate.
  const estimated = (input.job.preparation_snapshot as { preparation?: { objective?: unknown } } | null)?.preparation?.objective === "estimate";
  const answers = input.plan.answers.map((answer): TakeoffItemAnswer => {
    const designation = (labels.get(answer.itemId) ?? "").slice(0, 500);
    // Each contribution's row as it would be stored, then the trigger's reading of it.
    const rows = new Map(answer.observations.filter((entry) => entry.role === "contribution").map((entry) => {
      const unit = normalizeMeasurementUnit(entry.unit).unitCode ?? entry.unit!;
      const ruleInputs = withRules ? writableRuleInputs(ruleInputsFromDesignation({ designation, unit, quantity: entry.quantity!,
        evidence: entry.evidence, category: null })) : null;
      return [entry, { unit, ruleInputs }];
    }));
    const cause = [...rows.values()].map(({ ruleInputs }) => takeoffHypothesisCause({ metadata: {
      ...(estimated ? { quantity_nature: "estimated" } : {}), ...(ruleInputs ? { rule_inputs: ruleInputs } : {}) } }))
      .find((found) => found !== null) ?? null;
    const hypothesis = cause === null ? null : cause === "estimated" ? "QUANTITY_ESTIMATED" as const : "NOT_OBSERVABLE" as const;
    return {
      item_id: answer.itemId, outcome: hypothesis ? "uncertain" : answer.outcome,
      reasons: [...answer.reasons.map((reason) => ({ code: reason.code, by: reason.by, text: reason.text, chunk_id: reason.chunkId })),
        ...(hypothesis ? [{ code: hypothesis, by: "worker" as const, text: null, chunk_id: null }] : [])],
      searched_pages: [...answer.searchedPages], unreadable_pages: [...answer.unreadablePages],
      quantity: hypothesis ? null : answer.quantity, candidate: hypothesis ? answer.quantity : answer.candidate,
      observations: answer.observations.map((entry) => {
        let takeoffItemId: string | null = null;
        const row = rows.get(entry);
        if (row && !hypothesis) {
          takeoffItemId = crypto.randomUUID();
          items.push({ id: takeoffItemId, designation, quantity: entry.quantity!, unit: row.unit, confidence: entry.confidence, evidence: entry.evidence,
            source_file_name: input.fileName, source_page: entry.page, is_excluded: false, exclusion_reason: null,
            rules_stale: row.ruleInputs !== null,
            metadata: { source_document: input.planFile, poste: { item_id: answer.itemId, list_revision_id: input.list.revisionId,
              exchange: POSTE_EXCHANGE_SCHEMA_VERSION, chunk_id: entry.chunkId, method: entry.method },
            ...(row.ruleInputs ? { rule_inputs: row.ruleInputs } : {}) } });
        }
        const vectorKey = entry.source === "vector" ? vectorRows.get(entry.vectorKey ?? "") ?? null : null;
        if (entry.source === "vector" && !vectorKey) throw new Error("A vector observation has no vector row.");
        return { page: entry.page, evidence: entry.evidence, method: entry.method, confidence: entry.confidence, quantity: entry.quantity,
          unit: entry.unit, measurement_basis: entry.measurementBasis, role: row && hypothesis ? "candidate" : entry.role,
          source: entry.source, chunk_id: entry.chunkId, vector_key: vectorKey, takeoff_item_id: takeoffItemId };
      }),
    };
  });
  // The first findings in the reading's order, within the command's bound; the result says how many more were seen.
  const findings = input.plan.unlistedFindings.slice(0, TAKEOFF_ITEM_ANSWERS_MAX_FINDINGS).map((finding) => ({ page: finding.page,
    designation: finding.designation, evidence: finding.evidence, chunk_id: finding.chunkId }));
  const unkept = input.plan.unlistedFindings.length - findings.length;
  const { tokenUsage } = input.reading;
  return {
    p_job_id: input.job.id, p_lease_token: input.job.processing_lease_token ?? "", p_completed_at: input.completedAt.toISOString(),
    p_model: input.model, p_prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
    p_exchange: { schema_version: POSTE_EXCHANGE_SCHEMA_VERSION, prompt_version: POSTE_EXCHANGE_PROMPT_VERSION },
    p_unit_pages: [...input.reading.planPages].sort((left, right) => left - right),
    p_answers: answers, p_findings: findings,
    p_result: {
      // The raw readings of every call, mapped to the plan's pages: the answers' source, apart from any review.
      extracted_json: { format: "item_list", schema_version: POSTE_EXCHANGE_SCHEMA_VERSION, prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
        list: { revision_id: input.list.revisionId, revision: input.list.revision, item_count: input.list.itemCount },
        plan_pages: input.reading.planPages, fragments: input.reading.fragments },
      warnings: [...input.plan.warnings.map(({ code, message, severity }) => ({ code, message, severity })), ...findings.map(findingWarning),
        ...(unkept > 0 ? [{ code: "POSTE_HORS_LISTE_TRONQUE", severity: "warning" as const,
          message: `${unkept} ${unkept > 1 ? "autres ouvrages vus hors de la liste ne sont pas repris" : "autre ouvrage vu hors de la liste n’est pas repris"} `
            + `(${TAKEOFF_ITEM_ANSWERS_MAX_FINDINGS.toLocaleString("fr-FR")} au plus).` }] : [])],
      tables: [],
      provider_meta: {
        provider: "chatgpt", model: input.model, prompt_version: POSTE_EXCHANGE_PROMPT_VERSION, schema_version: POSTE_EXCHANGE_SCHEMA_VERSION,
        file_type: input.mimeType, source_file_name: input.fileName, processing_mode: "pdf_item_list", page_count: input.reading.pageCount,
        chunks_count: input.reading.chunksCount, calls: input.reading.calls, unattached_vector_readings: input.plan.unattachedVectorReadings.length,
        token_usage: { input_tokens: tokenUsage.inputTokens, reasoning_tokens: tokenUsage.reasoningTokens, output_tokens: tokenUsage.outputTokens,
          total_tokens: tokenUsage.totalTokens },
        chunks: input.reading.metrics,
        ...(input.job.preparation_snapshot ? { preparation_snapshot: publicTakeoffPreparationSnapshot(input.job.preparation_snapshot) } : {}),
      },
      confidence: null, token_count: tokenUsage.totalTokens, cost_cents: input.reading.costCents, duration_ms: input.reading.durationMs,
      job_duration_ms: input.totalDurationMs, run_metrics: input.runMetrics,
    },
    p_items: items,
    ...(vector ? { p_vector: vector } : {}),
  };
}

/**
 * What a refusal of the command means for the member and the unit (its public code, from visible-status.ts): an answer
 * the database could not store as the reading made it is « Extraction incomplète sur ce document. »; an order, a list or
 * pages that are not what the request sealed are an internal error; another attempt's lease, a conflict its holder
 * resolves. None is tried again: a new attempt would pay to read the plan again for the same refusal.
 */
const REFUSAL_CODES: Record<TakeoffItemAnswersRefusal, TakeoffErrorCode> = {
  TAKEOFF_ANSWERS_LEASE_INVALID: TakeoffErrorCode.CONFLICT,
  TAKEOFF_ANSWERS_ORDER_INVALID: TakeoffErrorCode.INTERNAL_ERROR,
  TAKEOFF_ANSWERS_SCOPE_UNKNOWN: TakeoffErrorCode.INTERNAL_ERROR,
  TAKEOFF_ANSWERS_UNIT_PAGES_MISMATCH: TakeoffErrorCode.INTERNAL_ERROR,
  TAKEOFF_ANSWERS_ITEM_MISSING: TakeoffErrorCode.INTERNAL_ERROR,
  TAKEOFF_ANSWERS_ITEM_FOREIGN: TakeoffErrorCode.INTERNAL_ERROR,
  TAKEOFF_ANSWERS_REQUIRED: TakeoffErrorCode.INTERNAL_ERROR,
  TAKEOFF_ANSWERS_INVALID: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_ALREADY_PUBLISHED: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_ITEM_DUPLICATE: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_PAGE_OUTSIDE: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_COVERAGE_INCOMPLETE: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_MEASURED_INVALID: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_NOT_FOUND_INVALID: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_UNCERTAIN_INVALID: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_VECTOR_ROWS_INVALID: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  TAKEOFF_ANSWERS_OBSERVATION_INVALID: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
};

const REFUSAL_MESSAGES: Record<TakeoffErrorCode.CONFLICT | TakeoffErrorCode.INTERNAL_ERROR | TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  string> = {
  [TakeoffErrorCode.CONFLICT]: "Le lease takeoff n'est plus disponible.",
  [TakeoffErrorCode.INTERNAL_ERROR]: "Les réponses de ce plan ne correspondent pas à la commande de mesure de sa demande : elles n’ont pas été enregistrées.",
  [TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA]: "Les réponses de ce plan n’ont pas pu être enregistrées telles que la lecture les a faites.",
};

/** The sendings of one publication at most: a lost answer or a transient failure is sent again, the same. */
const MAX_SENDINGS = 3;

/** A failure after which the same publication may be sent again: no answer, a serialization failure or a deadlock. */
function resendable(error: { code?: string; message?: string }) {
  return !error.code || error.code === "40001" || error.code === "40P01" || error.code.startsWith("PGRST0") || /^08/.test(error.code);
}

/**
 * The one call of the command (public.publish_takeoff_item_answers, migration 20261122080845_takeoff_item_answers.sql):
 * the answers, the result, its rows and the job's end in one transaction under the attempt's lease. Its digest covers every
 * argument (the random ids and `completed_at` included): the publication is built once for the attempt and sent as it is,
 * again when its answer is lost, which the database then answers as a replay of what it wrote. A refusal writes nothing
 * and is told by its code (REFUSAL_CODES).
 */
export async function publishTakeoffItemAnswers(supabase: Supabase, publication: TakeoffItemAnswersPublication): Promise<string> {
  const jobId = publication.p_job_id;
  for (let sending = 1; ; sending += 1) {
    const { data, error } = await supabase.rpc("publish_takeoff_item_answers", publication as never);
    if (!error) {
      const [row] = (data ?? []) as Array<{ result_id: string; replayed: boolean; answer_count: number }>;
      if (row?.result_id) return row.result_id;
      throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: true, jobId,
        message: "La publication des réponses de ce plan n’a rien répondu." });
    }
    const refusal = takeoffItemAnswersRefusal(error.message);
    if (refusal) {
      const code = REFUSAL_CODES[refusal];
      throw new TakeoffError({ status: code === TakeoffErrorCode.CONFLICT ? 409 : 422, code, retryable: false, jobId,
        message: REFUSAL_MESSAGES[code as keyof typeof REFUSAL_MESSAGES], details: { reason: refusal } });
    }
    if (!resendable(error) || sending >= MAX_SENDINGS) {
      throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: resendable(error), jobId,
        message: "Impossible d’enregistrer les réponses de ce plan.", details: { database_code: error.code ?? null } });
    }
  }
}
