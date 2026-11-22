import "server-only";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
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
  const answers = input.plan.answers.map((answer): TakeoffItemAnswer => ({
    item_id: answer.itemId, outcome: answer.outcome,
    reasons: answer.reasons.map((reason) => ({ code: reason.code, by: reason.by, text: reason.text, chunk_id: reason.chunkId })),
    searched_pages: [...answer.searchedPages], unreadable_pages: [...answer.unreadablePages], quantity: answer.quantity,
    candidate: answer.candidate,
    observations: answer.observations.map((entry) => {
      let takeoffItemId: string | null = null;
      if (entry.role === "contribution") {
        takeoffItemId = crypto.randomUUID();
        const designation = (labels.get(answer.itemId) ?? "").slice(0, 500);
        const unit = normalizeMeasurementUnit(entry.unit).unitCode ?? entry.unit!;
        const ruleInputs = withRules ? writableRuleInputs(ruleInputsFromDesignation({ designation, unit, quantity: entry.quantity!,
          evidence: entry.evidence, category: null })) : null;
        items.push({ id: takeoffItemId, designation, quantity: entry.quantity!, unit, confidence: entry.confidence, evidence: entry.evidence,
          source_file_name: input.fileName, source_page: entry.page, is_excluded: false, exclusion_reason: null, rules_stale: ruleInputs !== null,
          metadata: { source_document: input.planFile, poste: { item_id: answer.itemId, list_revision_id: input.list.revisionId,
            exchange: POSTE_EXCHANGE_SCHEMA_VERSION, chunk_id: entry.chunkId, method: entry.method },
          ...(ruleInputs ? { rule_inputs: ruleInputs } : {}) } });
      }
      const vectorKey = entry.source === "vector" ? vectorRows.get(entry.vectorKey ?? "") ?? null : null;
      if (entry.source === "vector" && !vectorKey) throw new Error("A vector observation has no vector row.");
      return { page: entry.page, evidence: entry.evidence, method: entry.method, confidence: entry.confidence, quantity: entry.quantity,
        unit: entry.unit, measurement_basis: entry.measurementBasis, role: entry.role, source: entry.source, chunk_id: entry.chunkId,
        vector_key: vectorKey, takeoff_item_id: takeoffItemId };
    }),
  }));
  const findings = input.plan.unlistedFindings.map((finding) => ({ page: finding.page, designation: finding.designation,
    evidence: finding.evidence, chunk_id: finding.chunkId }));
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
      warnings: [...input.plan.warnings.map(({ code, message, severity }) => ({ code, message, severity })), ...findings.map(findingWarning)],
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
 * The seam of the publication: the one call to PR 3a's command, wired once that command is on `main`. Until then a job of
 * the second order (which cannot exist before its activation) ends here with an explicit failure, never a silent one.
 */
export async function publishTakeoffItemAnswers(supabase: Supabase, publication: TakeoffItemAnswersPublication): Promise<string> {
  void supabase;
  throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId: publication.p_job_id,
    message: "La publication des réponses par poste n’est pas encore disponible : cette lecture n’a pas pu être enregistrée." });
}
