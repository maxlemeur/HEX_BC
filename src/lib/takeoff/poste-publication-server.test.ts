import { describe, expect, it } from "vitest";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { buildFailureDiagnostic } from "@/lib/takeoff/processing-job-state";
import { TAKEOFF_ITEM_ANSWERS_REFUSALS } from "@/lib/takeoff/item-answers";
import { createSupabaseFake } from "@/lib/takeoff/metre-m3.test-utils";
import { POSTE_EXCHANGE_PROMPT_VERSION, POSTE_EXCHANGE_SCHEMA_VERSION } from "@/lib/takeoff/poste-exchange";
import { publishTakeoffItemAnswers, type TakeoffItemAnswersPublication } from "@/lib/takeoff/poste-publication-server";

const JOB = "aaaaaaaa-0000-4000-8000-000000000040";
const RESULT = "dddddddd-0000-4000-8000-000000000001";
const ROW = "eeeeeeee-0000-4000-8000-000000000001";

/** A publication as the worker builds it: one measured item with its row, one item not found. */
function publication(): TakeoffItemAnswersPublication {
  return {
    p_job_id: JOB, p_lease_token: "aaaaaaaa-0000-4000-8000-000000000070", p_completed_at: "2026-11-22T09:00:00.000Z",
    p_model: "controlled", p_prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
    p_exchange: { schema_version: POSTE_EXCHANGE_SCHEMA_VERSION, prompt_version: POSTE_EXCHANGE_PROMPT_VERSION }, p_unit_pages: [1, 2],
    p_answers: [
      { item_id: "bbbbbbbb-0000-4000-8000-000000000001", outcome: "measured", reasons: [], searched_pages: [1, 2], unreadable_pages: [],
        quantity: { value: 3, unit: "u" }, candidate: null, observations: [{ page: 2, evidence: "trois symboles", method: "symbol_count",
          confidence: 0.9, quantity: 3, unit: "u", measurement_basis: null, role: "contribution", source: "model", chunk_id: "f1-b1",
          vector_key: null, takeoff_item_id: ROW }] },
      { item_id: "bbbbbbbb-0000-4000-8000-000000000002", outcome: "not_found", reasons: [{ code: "NO_INDICATION", by: "model",
        text: "Aucun indice.", chunk_id: "f1-b1" }], searched_pages: [1, 2], unreadable_pages: [], quantity: null, candidate: null,
        observations: [] },
    ],
    p_findings: [],
    p_result: { extracted_json: { format: "item_list" }, warnings: [], tables: [], provider_meta: {}, confidence: null, token_count: 1_000,
      cost_cents: 0, duration_ms: 1, job_duration_ms: 2, run_metrics: [] },
    p_items: [{ id: ROW, designation: "Lavabo", quantity: 3, unit: "u", confidence: 0.9, evidence: "trois symboles", source_file_name: "Plan.pdf",
      source_page: 2, metadata: {}, is_excluded: false, exclusion_reason: null, rules_stale: false }],
  };
}

/** The database's answers to the command, one per call, in order; each body as it was serialized when it was sent. */
function database(answers: Array<{ data?: unknown; error?: { code?: string; message: string } }>) {
  let call = 0;
  const bodies: string[] = [];
  const fake = createSupabaseFake({ rpc: { publish_takeoff_item_answers: (args) => {
    bodies.push(JSON.stringify(args));
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    return { data: answer.data ?? null, error: answer.error ?? null };
  } } });
  return Object.assign(fake, { bodies });
}

/** A clock and waits that take no time: each wait moves the clock, and is recorded. */
function clock() {
  let at = 0;
  const waits: number[] = [];
  return { waits, now: () => at, sleep: async (ms: number) => { waits.push(ms); at += ms; } };
}

async function refusal(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof TakeoffError) return error;
    throw error;
  }
  throw new Error("The publication was not refused.");
}

describe("publishTakeoffItemAnswers", () => {
  it("publishes the answers with the job's end in one call of the command, and gives the result", async () => {
    const fake = database([{ data: [{ result_id: RESULT, replayed: false, answer_count: 2 }] }]);
    const published = publication();
    await expect(publishTakeoffItemAnswers(fake.client as never, published)).resolves.toBe(RESULT);
    expect(fake.rpcCalls).toEqual([{ fn: "publish_takeoff_item_answers", args: published }]);
  });

  // #461: the digest covers every argument (random ids and completed_at included): a replay must send the same
  // serialized publication, built once for the attempt, or the database answers TAKEOFF_ANSWERS_ALREADY_PUBLISHED.
  it("resends the same serialized publication when its answer is lost, and takes the database's replay", async () => {
    const fake = database([{ error: { code: "", message: "TypeError: fetch failed" } },
      { data: [{ result_id: RESULT, replayed: true, answer_count: 2 }] }]);
    const published = publication();
    const sent = JSON.stringify(published);
    const time = clock();
    await expect(publishTakeoffItemAnswers(fake.client as never, published, time)).resolves.toBe(RESULT);
    // Each body as it left: the same serialization at each sending.
    expect(fake.bodies).toEqual([sent, sent]);
  });

  // PR 3c fix round, point 5: an answer without its result is a lost answer; a transient failure is sent again with a
  // backoff, the lease renewed between sendings, for as long as the lease safely allows.
  it("resends after a serialization failure, a deadlock or an answer without its result, renewing the lease between sendings", async () => {
    for (const lost of [{ error: { code: "40001", message: "could not serialize access" } }, { error: { code: "40P01", message: "deadlock" } },
      { data: [] }, { data: [{ replayed: false, answer_count: 2 }] }]) {
      const fake = database([lost, { data: [{ result_id: RESULT, replayed: false, answer_count: 2 }] }]);
      const time = clock();
      let renewed = 0;
      await expect(publishTakeoffItemAnswers(fake.client as never, publication(), { ...time, renewLease: async () => { renewed += 1; } }))
        .resolves.toBe(RESULT);
      expect(fake.bodies).toHaveLength(2);
      expect(fake.bodies[1]).toBe(fake.bodies[0]);
      expect([time.waits, renewed]).toEqual([[1_000], 1]);
    }
  });

  it("gives up after ten minutes without retrying the plan's reading, and tells the member to launch it again", async () => {
    const lost = database([{ error: { code: "", message: "TypeError: fetch failed" } }]);
    const time = clock();
    // A renewal that fails (the job ended, or its lease went elsewhere) never stops the sendings: their answer decides.
    const error = await refusal(() => publishTakeoffItemAnswers(lost.client as never, publication(),
      { ...time, renewLease: async () => { throw new Error("renewal refused"); } }));
    expect(error).toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId: JOB,
      message: expect.stringContaining("La lecture de ce plan n’a pas pu être enregistrée") });
    expect(time.waits.slice(0, 7)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(time.now()).toBeGreaterThanOrEqual(600_000);
    expect(time.now()).toBeLessThan(600_000 + 30_000);
    expect(new Set(lost.bodies).size).toBe(1);
  });

  // Each refusal of the command: what the member is told (the job's public code) and whether the unit may be tried again.
  it("tells each refusal of the command by its code, never retried, and resends none", async () => {
    const expected: Record<string, TakeoffErrorCode> = {
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
    expect(Object.keys(expected).sort()).toEqual([...TAKEOFF_ITEM_ANSWERS_REFUSALS].sort());
    for (const [code, takeoffCode] of Object.entries(expected)) {
      const fake = database([{ error: { code: code === "TAKEOFF_ANSWERS_LEASE_INVALID" ? "55000" : "22023", message: code } }]);
      const error = await refusal(() => publishTakeoffItemAnswers(fake.client as never, publication(), clock()));
      expect(fake.rpcCalls).toHaveLength(1);
      expect(error).toMatchObject({ code: takeoffCode, retryable: false, jobId: JOB });
      // The member reads the code's own sentence and reason; the database's words never reach them, in the job's detail
      // neither (its failure diagnostic, PR 3c fix round point 6).
      expect(error.message).not.toContain(code);
      const detail = buildFailureDiagnostic({ error, durationMs: 1, model: "controlled", promptVersion: "takeoff-c-postes-v1",
        retainMetrics: false });
      expect(JSON.stringify(detail)).not.toContain("TAKEOFF_ANSWERS");
      expect((detail?.raw_response as Record<string, unknown>).reason).toBe({ [TakeoffErrorCode.CONFLICT]: "publication_lease_lost",
        [TakeoffErrorCode.INTERNAL_ERROR]: "publication_order_mismatch",
        [TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA]: "publication_answers_refused" }[takeoffCode as string]);
    }
  });

  it("ends on another failure of the database without resending", async () => {
    const constraint = database([{ error: { code: "23505", message: "duplicate key value violates unique constraint" } }]);
    const error = await refusal(() => publishTakeoffItemAnswers(constraint.client as never, publication(), clock()));
    expect(error).toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
    expect(JSON.stringify(error.details ?? {})).not.toContain("23505");
    expect(constraint.rpcCalls).toHaveLength(1);
  });
});
