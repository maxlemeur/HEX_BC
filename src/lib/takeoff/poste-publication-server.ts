import "server-only";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffHypothesisCause } from "@/lib/takeoff/hypothesis";
import { TAKEOFF_ITEM_ANSWER_LIMITS, takeoffItemAnswerText } from "@/lib/takeoff/item-answer-limits";
import { takeoffItemAnswersRefusal, type TakeoffItemAnswersRefusal } from "@/lib/takeoff/item-answers";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { buildLevelCRunMetricRows } from "@/lib/takeoff/level-c-chunk-metrics";
import { POSTE_EXCHANGE_PROMPT_VERSION, POSTE_EXCHANGE_SCHEMA_VERSION } from "@/lib/takeoff/poste-exchange";
import type { PostePlanReading } from "@/lib/takeoff/poste-exchange-merge";
import type { Poste } from "@/lib/takeoff/poste-list";
import { publishedObservation, publishedReason, type TakeoffItemAnswer } from "@/lib/takeoff/poste-publication-size";
import { posteVectorKey, type PosteUnitReading } from "@/lib/takeoff/poste-reading";
import { publicTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import type { Supabase } from "@/lib/takeoff/processing-context";
import { writableRuleInputs } from "@/lib/takeoff/rules/contracts";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import { isTakeoffRulesEnabled } from "@/lib/takeoff/rules/recompute-server";
import type { TakeoffSourceDocumentRef } from "@/lib/takeoff/source-loader";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import { buildTakeoffVectorPersistence, type VectorReadingLeftOut } from "@/lib/takeoff/vectors/worker-persistence-server";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

/**
 * The input of the publication command of one unit of the second measuring order (lot 4 PR 3a's command, its contract in
 * addendum 1): for a job that read its plan against the sealed list, the answers of every item of the unit's scope and
 * the job's end, written in one transaction by the worker under its lease. The command reads the request, the unit and
 * the sealed list revision itself; it is given only what the reading produced, and what today's end of a job takes.
 */
export type { TakeoffItemAnswer, TakeoffItemAnswerObservation } from "@/lib/takeoff/poste-publication-size";

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
export const TAKEOFF_ITEM_ANSWERS_MAX_FINDINGS = TAKEOFF_ITEM_ANSWER_LIMITS.findings;

/** A finding outside the list as the result's warning: one line, bounded as a warning is, cut on whole characters. */
function findingWarning(finding: { page: number; designation: string; evidence: string }) {
  return { code: "POSTE_HORS_LISTE", severity: "info" as const,
    message: takeoffItemAnswerText(`Page ${finding.page} : ${finding.designation} — ${finding.evidence}`) };
}

/** What the result says of a vector page, or of its rows, left out because the database could not store them. */
function vectorLeftOutWarning(leftOut: VectorReadingLeftOut) {
  const message = leftOut.whole
    ? `La lecture vectorielle de la page ${leftOut.page} n’a pas pu être gardée : elle n’est pas reprise.`
    : leftOut.items > 1
      ? `${leftOut.items} lectures vectorielles de la page ${leftOut.page} sont hors de ce que le métré enregistre : elles ne sont pas reprises.`
      : `1 lecture vectorielle de la page ${leftOut.page} est hors de ce que le métré enregistre : elle n’est pas reprise.`;
  return { code: "POSTE_VECTEUR_ECARTE", severity: "warning" as const, message };
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
  /** The vector pages the database can store (`storableVectorOutcomes`), and what was left out of them. */
  vectorOutcomes: readonly VectorPageOutcome[];
  vectorLeftOut?: readonly VectorReadingLeftOut[];
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
    // Cut on whole characters: a character cut in two would make the publication's JSON invalid.
    const designation = takeoffItemAnswerText(labels.get(answer.itemId) ?? "");
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
      reasons: [...answer.reasons.map(publishedReason), ...(hypothesis ? [{ code: hypothesis, by: "worker" as const, text: null, chunk_id: null }] : [])],
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
        return publishedObservation(entry, { takeoffItemId, vectorKey }, row && hypothesis ? "candidate" : entry.role);
      }),
    };
  });
  // Within what the command stores by construction (the admission's bound, the merge's attachment of vector readings):
  // checked again before anything is sent, never refused after.
  if (jsonbTextBytes(answers) > TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes) throw new Error("The answers pass what the publication stores.");
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
            + `(${TAKEOFF_ITEM_ANSWERS_MAX_FINDINGS.toLocaleString("fr-FR")} au plus).` }] : []),
        ...(input.vectorLeftOut ?? []).map(vectorLeftOutWarning)],
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
      // Whole numbers, as the result's integer columns and the job's end read them (a fraction would refuse the call).
      confidence: null, token_count: Math.round(tokenUsage.totalTokens), cost_cents: Math.round(input.reading.costCents),
      duration_ms: Math.round(input.reading.durationMs), job_duration_ms: Math.round(input.totalDurationMs), run_metrics: input.runMetrics,
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

/**
 * The resending of a publication whose answer is lost: waits from one second, doubled up to thirty, for ten minutes at
 * most. The job's lease lasts thirty minutes from its last renewal, made between the reading's calls and again between
 * the sendings: ten minutes of sendings stay within it even when a renewal fails.
 */
export const TAKEOFF_ITEM_ANSWERS_RESEND = { firstWaitMs: 1_000, maxWaitMs: 30_000, forMs: 10 * 60_000 } as const;

/** A failure after which the same publication may be sent again: no answer, a serialization failure or a deadlock. */
function resendable(error: { code?: string; message?: string }) {
  return !error.code || error.code === "40001" || error.code === "40P01" || error.code.startsWith("PGRST0") || /^08/.test(error.code);
}

/**
 * What a member's job detail keeps of a failed publication (its diagnostic's `raw_response`), in the worker's own words:
 * never the database's code or message, which the worker's log keeps.
 */
const FAILURE_REASONS: Record<TakeoffErrorCode.CONFLICT | TakeoffErrorCode.INTERNAL_ERROR | TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
  string> = {
  [TakeoffErrorCode.CONFLICT]: "publication_lease_lost",
  [TakeoffErrorCode.INTERNAL_ERROR]: "publication_order_mismatch",
  [TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA]: "publication_answers_refused",
};

/**
 * The one call of the command (public.publish_takeoff_item_answers, migration 20261122080845_takeoff_item_answers.sql):
 * the answers, the result, its rows and the job's end in one transaction under the attempt's lease. Its digest covers every
 * argument (the random ids and `completed_at` included): the publication is built once for the attempt and sent as it is,
 * again when its answer is lost (no answer, or one without its result), after a serialization failure or a deadlock, which
 * the database then answers as a replay of what it wrote. The sendings go on while their next wait ends within
 * TAKEOFF_ITEM_ANSWERS_RESEND.forMs, the lease renewed between them; then the plan's reading is not tried again (a new attempt would pay to read it again) and
 * the member is told it was not recorded. A refusal writes nothing and is told by its code (REFUSAL_CODES).
 */
export async function publishTakeoffItemAnswers(supabase: Supabase, publication: TakeoffItemAnswersPublication, options: {
  now?: () => number; sleep?: (ms: number) => Promise<void>; renewLease?: () => Promise<void>;
} = {}): Promise<string> {
  const jobId = publication.p_job_id;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  let lost: string | null = null;
  for (let wait: number = TAKEOFF_ITEM_ANSWERS_RESEND.firstWaitMs, sendings = 1; ; sendings += 1) {
    const { data, error } = await supabase.rpc("publish_takeoff_item_answers", publication as never);
    if (!error) {
      const [row] = (data ?? []) as Array<{ result_id?: string; replayed?: boolean; answer_count?: number }>;
      if (row?.result_id) return row.result_id;
      lost = "no_result";
    } else {
      const refusal = takeoffItemAnswersRefusal(error.message);
      if (refusal) {
        const code = REFUSAL_CODES[refusal] as keyof typeof REFUSAL_MESSAGES;
        console.error("takeoff.item_answers.refused", { jobId, refusal });
        throw new TakeoffError({ status: code === TakeoffErrorCode.CONFLICT ? 409 : 422, code, retryable: false, jobId,
          message: REFUSAL_MESSAGES[code], details: { reason: FAILURE_REASONS[code] } });
      }
      if (!resendable(error)) {
        console.error("takeoff.item_answers.failed", { jobId, databaseCode: error.code ?? null });
        throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId,
          message: "Impossible d’enregistrer les réponses de ce plan.", details: { reason: "publication_failed" } });
      }
      lost = error.code || "no_answer";
    }
    // Checked before the wait: no wait, and no sending after it, starts past the deadline.
    if (now() - startedAt + wait > TAKEOFF_ITEM_ANSWERS_RESEND.forMs) {
      console.error("takeoff.item_answers.unrecorded", { jobId, sendings, last: lost });
      throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId,
        message: "La lecture de ce plan n’a pas pu être enregistrée : relancez-la depuis les options du métré.",
        details: { reason: "publication_unrecorded" } });
    }
    await sleep(wait);
    wait = Math.min(wait * 2, TAKEOFF_ITEM_ANSWERS_RESEND.maxWaitMs);
    // A renewal refused (the job ended with a sending that committed, or its lease went elsewhere) never stops the
    // sendings: the next one's answer decides (a replay, or the lease's refusal).
    await options.renewLease?.().catch(() => undefined);
  }
}
