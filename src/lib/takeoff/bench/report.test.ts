import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS } from "@/lib/takeoff/benchmark";
import { buildBenchReport, percentile, renderBenchReportMarkdown, type BenchReportMetadata } from "@/lib/takeoff/bench/report";
import {
  planBenchDocuments,
  runTakeoffBench,
  type BenchCallResult,
  type BenchCouple,
  type BenchRunResult,
  type ChunkCall,
  type DocumentRun,
} from "@/lib/takeoff/bench/run";
import { NoiseFileSchema, ManifestDocumentSchema, TruthFileSchema, type ManifestDocument } from "@/lib/takeoff/bench/schemas";
import { buildScoreScopes } from "@/lib/takeoff/bench/score";
import type { TakeoffItem } from "@/lib/takeoff/types";

// Ways the bench report (TI-660) could misstate a run, written before the code.
// Every document, label and quantity is fictional:
// - p50 / p95 interpolated or taken on the wrong calls: nearest rank on the
//   per-page durations, a timeout counted at 180 s or more in the first
//   distribution and absent from the distribution of completed calls, a
//   rejected request in neither; timeouts not listed by lot;
// - the reserve mixed into the lots it is held out from;
// - the three token counts added into one, or the usage of a schema failure lost;
// - the indicative passed / failedChecks presented as a verdict, or not computed
//   with the thresholds of the fictional fixture (evaluateTakeoffBenchmark);
// - report.md publishing a quantity or a designation read on a plan, or the
//   tolerance of a key (10 % of its quantity), instead of codes, counts and
//   relative deviations;
// - report.md copying free text of the private dataset (the reason of
//   truth/noise.json), which may name a project;
// - lots ordered by the order documents ran in, so that two identical runs
//   differ in structure, or lots and scopes that did not run listed as zeros;
// - the noise of truth/noise.json not set against the tolerance of its unit;
// - an incomplete run not saying where it stopped, after how many calls.
// Found in review, written before their fix:
// - a document whose chunk timed out or failed is scored as read: every key of
//   its unread pages is « nous:manque » and « non relu », with no warning;
// - report.md copies the room labels of the truth (printed names of a private
//   plan) for surface keys, in the scope tables and the noise table.
// Found in the second review, written before its fix:
// - two identical items read by two chunks on the page they overlap, which the
//   merge keeps apart (one spelling has punctuation), are added up as an
//   unexplained deviation: the double count of two blocks is never seen.
// Found in the TI-663 review, written before its fix:
// - a document the page triage fully excluded drops out of the score of the
//   « après » run instead of counting its keys as missed.
// Found in the third review, written before its fix:
// - report.md says a surface noise above 2 % is out of tolerance (« non »),
//   while the 0.5 m² floor of max(2 %, 0.5 m²) may accept it: without a
//   quantity, it cannot say.

function manifestDocument(id: string, overrides: Record<string, unknown> = {}): ManifestDocument {
  const [lot, kind] = id.split("-");
  return ManifestDocumentSchema.parse({
    id, lot, kind, drive_id: `fixture-${id}`, original_title: `Fictional ${id}`, project: null, file_type: "pdf",
    file_size: 100, modified_time: "2026-01-06T10:00:00.000Z", raw_status: "binary", raw_path: `raw/${id}.pdf`,
    sha256: "0".repeat(64), structure_check: { status: "passed", method: "fixture", detail: null }, pages: 3,
    format: "A0", scale: "1/50", index: "A", vector: true, ocg_count: 0, level: "R+1", zone: "Z1", role: "truth",
    duplicate_of: null, notes: null, ...overrides,
  });
}

function call(overrides: Partial<ChunkCall>): ChunkCall {
  return {
    chunk: 1, chunks: 1, start_page: 1, end_page: 1, pages: 1, bytes: 1000, status: "ok", duration_ms: 1000,
    duration_per_page_ms: 1000, model: "fixture-model", reasoning_effort: "medium", prompt_version: "takeoff-c-v1",
    usage: { input: 20, output: 6, reasoning: 4, total: 30 }, items: 1, warnings: 0, error: null, ...overrides,
  };
}

function documentRun(id: string, calls: ChunkCall[], items: TakeoffItem[], role: "truth" | "reserve" = "truth"): DocumentRun {
  return {
    id, lot: id.split("-")[0], role, sha256: "0".repeat(64), bytes: 1000, pages: 3, chunks_planned: calls.length, complete: true,
    calls, failed_chunks: calls.filter((entry) => entry.status !== "ok").length, items, item_chunks: items.map(() => [1]),
    duplicate_items: 1, deduplicated_items: items.length,
  };
}

function item(designation: string, quantity: number): TakeoffItem {
  return { designation, quantity, unit: "ml", source_page: 1, confidence: 0.9, evidence: "Fictional evidence" };
}

function truthLine(overrides: Record<string, unknown>) {
  return {
    kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", organ: null, room: null,
    unit: "ml", quantity: 12.345, observable_on_plan: true,
    source: { document: "a-devis-01", sheet: "Lot", row: 1, row_basis: "workbook", text: "Fictional row" }, ...overrides,
  };
}

const documents = [
  manifestDocument("a-plan-01"), manifestDocument("a-plan-02", { zone: "Z2", role: "reserve" }), manifestDocument("d-plan-01", { zone: null, level: "RDC" }),
];
const truthFiles = [
  { file: "truth/a-plan-01.json", truth: TruthFileSchema.parse({
    schema_version: 1, lot: "a", scope: "document", documents: ["a-plan-01"], source_document: "a-devis-01", rules: "Fictional.",
    lines: [truthLine({})],
  }) },
  { file: "truth/a-plan-02.json", truth: TruthFileSchema.parse({
    schema_version: 1, lot: "a", scope: "document", documents: ["a-plan-02"], source_document: "a-devis-01", rules: "Fictional.",
    lines: [truthLine({ zone: "Z2", network: "ECS", quantity: 4 })],
  }) },
  { file: "truth/d-plan-01.json", truth: TruthFileSchema.parse({
    schema_version: 1, lot: "d", scope: "document", documents: ["d-plan-01"], source_document: "d-plan-01", rules: "Fictional.",
    lines: [truthLine({ kind: "surface", zone: null, level: "RDC", network: null, material: null, dn: null, room: "Fictional hall", unit: "m2",
      quantity: 20, source: { document: "d-plan-01", sheet: null, row: null, page: 1, text: "Fictional" } })],
  }) },
];
const metadata: BenchReportMetadata = {
  started_at: "2026-11-01T10:00:00.000Z", finished_at: "2026-11-01T10:05:00.000Z", command: ["npm", "run", "takeoff:bench"],
  cwd: "/fixture/checkout", env: { TAKEOFF_BENCH_CHATGPT_OWNER: "fixture-user:fixture-tenant" }, node: "v26.12.1", commit: "f".repeat(40), dirty: false,
  dataset: { sha256: "e".repeat(64), documents: [], skipped: [{ id: "b-plan-01", reason: "no verified binary (raw_status failed)" }] },
  profile: { model: "fixture-model", reasoning_effort: "medium", unchanged: true },
};

function run(documentsRun: DocumentRun[], status: BenchRunResult["status"] = "complete"): BenchRunResult {
  return {
    status, stop: null, calls_planned: 8, calls_done: 8,
    couples: [{ model: "fixture-model", reasoning_effort: "medium", override: false, prompt_version: "takeoff-c-v1",
      passes: [{ pass: 1, complete: status === "complete", documents: documentsRun }] }],
  };
}

const latencyCalls = [
  call({ pages: 10, start_page: 1, end_page: 10, duration_ms: 20_000 }),
  call({ duration_ms: 1_000 }),
  call({ status: "schema_failure", duration_ms: 3_000, usage: { input: 11, output: 3, reasoning: 2, total: 16 }, prompt_version: null, items: null }),
  call({ status: "timeout", pages: 2, start_page: 2, end_page: 3, bytes: 4321, duration_ms: 179_000, usage: null, prompt_version: null, items: null,
    error: { name: "TimeoutError", code: null, message: "The operation was aborted due to timeout" } }),
  call({ status: "rejected", duration_ms: 500, usage: null, prompt_version: null, items: null }),
];

describe("takeoff bench report", () => {
  it("takes p50 and p95 by nearest rank", () => {
    expect([percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 50), percentile([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 95)]).toEqual([5, 10]);
    expect([percentile([7], 50), percentile([7], 95), percentile([], 50)]).toEqual([7, 7, null]);
  });

  it("counts timeouts at 180 s or more per page, apart from completed calls, and lists them by lot", () => {
    const report = buildBenchReport({ metadata, run: run([documentRun("a-plan-01", latencyCalls, [item("EF cuivre DN 22", 12.345)])]),
      scopes: buildScoreScopes(truthFiles, documents), noise: null });
    // Lot D has a truth but did not run: it is neither a row of the lots nor a table of keys.
    expect(Object.keys(report.couples[0].passes[0].summary.main.lots)).toEqual(["a"]);
    const markdown = renderBenchReportMarkdown(report);
    expect(markdown).toContain("Non notés (un de leurs documents n'a pas été lu dans cette passe) : a-plan-02, d-plan-01");
    expect(markdown).not.toMatch(/^#### d-plan-01/m);
    expect(markdown).not.toMatch(/^\| D \|/m);
    const lot = report.couples[0].passes[0].summary.main.lots.a;
    expect(lot.latency_per_page).toEqual({ n: 4, p50_ms: 2_000, p95_ms: 90_000, timeouts_counted_at_ms: 180_000 });
    expect(lot.completed_latency_per_page).toEqual({ n: 3, p50_ms: 2_000, p95_ms: 3_000 });
    expect(lot.timeouts).toEqual([{
      document: "a-plan-01", start_page: 2, end_page: 3, pages: 2, bytes: 4321, model: "fixture-model", reasoning_effort: "medium", duration_ms: 179_000,
    }]);
    expect(lot.statuses).toMatchObject({ ok: 2, schema_failure: 1, timeout: 1, rejected: 1 });
    expect(lot.tokens).toEqual({ input: 51, output: 15, reasoning: 10, total: 76 });
  });

  it("reports the reserve apart from the lots, in a stable lot order", () => {
    const report = buildBenchReport({
      metadata,
      run: run([
        documentRun("d-plan-01", [call({})], []),
        documentRun("a-plan-02", [call({})], [item("ECS cuivre DN 22", 4)], "reserve"),
        documentRun("a-plan-01", [call({})], [item("EF cuivre DN 22", 12.345)]),
      ]),
      scopes: buildScoreScopes(truthFiles, documents), noise: null,
    });
    const { main, reserve } = report.couples[0].passes[0].summary;
    expect(Object.keys(main.lots)).toEqual(["a", "d"]);
    expect(Object.keys(reserve.lots)).toEqual(["a"]);
    expect(main.lots.a).toMatchObject({ documents: 1, score: { keys_scored: 1, keys_ok: 1 } });
    expect(reserve.lots.a).toMatchObject({ documents: 1, score: { keys_scored: 1, keys_ok: 1 } });
  });

  it("computes the indicative checks with the thresholds of the fictional fixture, labelled as such", () => {
    const passing = buildBenchReport({ metadata, run: run([documentRun("a-plan-01", [call({})], [item("EF cuivre DN 22", 12.345)])]),
      scopes: buildScoreScopes(truthFiles, documents), noise: null });
    expect(passing.couples[0].passes[0].indicative).toMatchObject({
      note: "indicatif, seuils de la fixture fictive", passed: true, failedChecks: [], thresholds: DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS,
    });
    const failing = buildBenchReport({
      metadata,
      run: run([documentRun("a-plan-01", [call({})], [item("EF cuivre DN 22", 12.345), item("EP PVC DN 100", 3)])]),
      scopes: buildScoreScopes(truthFiles, documents), noise: null,
    });
    expect(failing.couples[0].passes[0].indicative).toMatchObject({ passed: false, precision: 0.5, recall: 1 });
    expect(failing.couples[0].passes[0].indicative.failedChecks).toContain("precision");
  });

  it("publishes in report.md codes, counts and relative deviations, never a quantity or a designation", () => {
    const report = buildBenchReport({
      metadata,
      run: run([documentRun("a-plan-01", [call({})], [item("EF cuivre DN 22 Fictional Quayside", 13.704), item("EP PVC DN 100 Fictional Harbour", 2.468)])]),
      scopes: buildScoreScopes(truthFiles, documents), noise: null,
    });
    const markdown = renderBenchReportMarkdown(report);
    expect(markdown).toContain("indicatif, seuils de la fixture fictive");
    expect(markdown).toMatch(/Z1 R\+1 EF cuivre DN 22 ml \| hors tolérance \| \+11\.0 %/);
    expect(markdown).toContain("nous:invente");
    for (const leak of ["12.345", "13.704", "2.468", "1.2345", "Quayside", "Harbour", "Fictional row"]) expect(markdown).not.toContain(leak);
  });

  it("does not score a scope whose document lost a chunk, and names the pages not read", () => {
    const timedOut = call({ status: "timeout", duration_ms: 180_000, usage: null, prompt_version: null, items: null,
      error: { name: "TimeoutError", code: null, message: "The operation was aborted due to timeout" } });
    const report = buildBenchReport({ metadata, run: run([documentRun("a-plan-01", [timedOut], [])]),
      scopes: buildScoreScopes(truthFiles, documents), noise: null });
    const pass = report.couples[0].passes[0];
    const scope = pass.scopes.find((entry) => entry.documents.includes("a-plan-01"));
    expect(scope).toMatchObject({ status: "read_failed", keys: [], false_positives: [],
      unread_pages: [{ document: "a-plan-01", start_page: 1, end_page: 1, status: "timeout" }] });
    expect(scope?.warnings.join(" ")).toMatch(/a-plan-01 pages 1-1.*timeout/);
    expect(pass.summary.main.lots.a).toMatchObject({ statuses: { timeout: 1 }, score: { scopes_read_failed: 1, keys_missed: 0, not_reviewed: 0, causes: {} } });
    const markdown = renderBenchReportMarkdown(report);
    expect(markdown).toMatch(/lecture en échec[^\n]*a-plan-01 pages 1-1 \(timeout\)/);
    expect(markdown).not.toContain("nous:manque");
    expect(markdown).not.toMatch(/^#### a-plan-01/m);
  });

  it("scores a document the page triage excluded as read without items, its keys missed", () => {
    const report = buildBenchReport({ metadata, run: run([]), scopes: buildScoreScopes(truthFiles, documents), noise: null, excludedDocuments: ["a-plan-01"] });
    const pass = report.couples[0].passes[0];
    expect(pass.scopes.find((entry) => entry.documents.includes("a-plan-01"))?.status).toBe("scored");
    expect(pass.summary.main.lots.a.score).toMatchObject({ scopes: 1, keys_missed: 1 });
  });

  it("publishes the rooms of surface keys in report.md as an index, never their label", () => {
    const room = (overrides: Record<string, unknown>) => ({
      kind: "surface", zone: null, level: "RDC", network: null, material: null, dn: null, organ: null, unit: "m2", ...overrides,
    });
    const noise = NoiseFileSchema.parse({
      schema_version: 1, status: "measured", reason: null, baseline_document: "d-surfaces-01", comparison_document: "d-plan-01",
      documents: ["d-plan-01"], plan_index_same: true, rules: "Fictional.",
      keys: [room({ room: "Fictional hall", relative_deviation: 0.01, reason: null })],
    });
    const report = buildBenchReport({
      metadata, run: run([documentRun("d-plan-01", [call({})], [{ ...item("Fictional hall", 20), unit: "m²" }, { ...item("Fictional hall", 3), unit: "m²", source_page: 9 }])]),
      scopes: buildScoreScopes(truthFiles, documents), noise,
    });
    const scope = report.couples[0].passes[0].scopes.find((entry) => entry.documents.includes("d-plan-01"));
    expect(scope?.keys).toMatchObject([{ key: { room: "Fictional hall" } }]);
    const markdown = renderBenchReportMarkdown(report);
    expect(markdown).toMatch(/^#### d-plan-01/m);
    expect(markdown).toMatch(/- RDC pièce 1 m2 \|/);
    expect(markdown).not.toContain("Fictional hall");
  });

  it("sets the noise of truth/noise.json against the tolerance of its unit", () => {
    const noise = NoiseFileSchema.parse({
      schema_version: 1, status: "measured", reason: null, baseline_document: "a-devis-01", comparison_document: "a-devis-02",
      documents: ["a-plan-01"], plan_index_same: true, rules: "Fictional.",
      keys: [
        { kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", organ: null, room: null, unit: "ml", relative_deviation: 0.04, reason: null },
        { kind: "network", zone: "Z1", level: "R+1", network: "ECS", material: "cuivre", dn: "DN 22", organ: null, room: null, unit: "ml", relative_deviation: -0.15, reason: null },
        { kind: "count", zone: "Z1", level: "R+1", network: "EF", material: null, dn: "DN 20", organ: "vanne", room: null, unit: "u", relative_deviation: 0.5, reason: null },
        { kind: "count", zone: "Z1", level: "R+1", network: "EF", material: null, dn: null, organ: "compteur", room: null, unit: "ens", relative_deviation: 0, reason: null },
        { kind: "count", zone: "Z1", level: "R+1", network: "ECS", material: null, dn: "DN 20", organ: "vanne", room: null, unit: "u", relative_deviation: null, reason: "Fictional." },
      ],
    });
    const report = buildBenchReport({ metadata, run: run([]), scopes: buildScoreScopes(truthFiles, documents), noise });
    expect(report.noise?.keys.map((key) => [key.unit, key.tolerance_relative, key.within])).toEqual([
      ["ml", 0.1, true], ["ml", 0.1, false], ["u", 0, false], ["ens", null, null], ["u", 0, null],
    ]);
    const unmeasured = NoiseFileSchema.parse({
      schema_version: 1, status: "not_measured", reason: "Fictional private reason naming a project.", baseline_document: null,
      comparison_document: null, documents: [], plan_index_same: null, rules: "Fictional.", keys: [],
    });
    const markdown = renderBenchReportMarkdown(buildBenchReport({ metadata, run: run([]), scopes: [], noise: unmeasured }));
    expect(markdown).toContain("not_measured");
    expect(markdown).not.toContain("Fictional private reason");
  });

  it("leaves undetermined a surface noise above 2 %, whose 0.5 m² floor needs a quantity", () => {
    const surface = (room: string, relativeDeviation: number) => ({
      kind: "surface", zone: null, level: "RDC", network: null, material: null, dn: null, organ: null, room, unit: "m2",
      relative_deviation: relativeDeviation, reason: null,
    });
    const noise = NoiseFileSchema.parse({
      schema_version: 1, status: "measured", reason: null, baseline_document: "d-surfaces-01", comparison_document: "d-plan-01",
      documents: ["d-plan-01"], plan_index_same: true, rules: "Fictional.",
      keys: [
        surface("Fictional hall", 0.03),
        surface("Fictional porch", -0.015),
        { kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "calorifuge", dn: "DN 22", organ: null, room: null, unit: "m2", relative_deviation: 0.04, reason: null },
      ],
    });
    const report = buildBenchReport({ metadata, run: run([]), scopes: buildScoreScopes(truthFiles, documents), noise });
    expect(report.noise?.keys.map((key) => key.within)).toEqual([null, true, null]);
    const markdown = renderBenchReportMarkdown(report);
    const undetermined = "indéterminé (part absolue 0,5 m² non évaluable sans quantité)";
    expect(markdown).toContain(`| +3.0 % | 2 % | ${undetermined} |`);
    expect(markdown).toContain(`| +4.0 % | 2 % | ${undetermined} |`);
    expect(markdown).toContain("| -1.5 % | 2 % | oui |");
    expect(markdown).not.toContain("| 2 % | non |");
  });

  it("calls two identical items of two chunks on their overlap page a double count, not two items of one chunk", async () => {
    const couple: BenchCouple = { model: "fixture-model", reasoningEffort: "medium", override: false };
    const answer = (items: TakeoffItem[]): BenchCallResult => ({
      data: { items, warnings: [], confidence: 0.8, metadata: { level: "C", prompt_version: "takeoff-c-v1", file_type: "application/pdf", schema_version: "v1" } },
      tokenCount: 1, tokenUsage: { inputTokens: 1, outputTokens: 0, reasoningTokens: 0, totalTokens: 1 }, costCents: 0, durationMs: 1,
      model: couple.model, reasoningEffort: couple.reasoningEffort, promptVersion: "takeoff-c-v1", providerBatchId: null, providerBatchStateRaw: null,
    });
    const keyOf = async (pages: number, answers: TakeoffItem[][]) => {
      const pdf = await PDFDocument.create();
      for (let page = 0; page < pages; page += 1) pdf.addPage([420, 297]);
      const plans = await planBenchDocuments([{ id: "a-plan-01", lot: "a", role: "truth", bytes: await pdf.save(), sha256: "0".repeat(64) }]);
      let index = 0;
      const result = await runTakeoffBench({ plans, couples: [couple], repeat: 1, call: async () => answer(answers[index++]) });
      const scopes = buildScoreScopes([truthFiles[0]], [manifestDocument("a-plan-01", { pages })]);
      return buildBenchReport({ metadata, run: result, scopes, noise: null }).couples[0].passes[0].scopes[0].keys[0];
    };
    // Chunks 1 (pages 1-10) and 2 (pages 9-16) both read page 9.
    const twoChunks = await keyOf(16, [[{ ...item("EF - cuivre DN 22", 12.345), source_page: 9 }], [{ ...item("EF cuivre DN 22", 12.345), source_page: 1 }]]);
    expect(twoChunks).toMatchObject({ status: "out_of_tolerance", items: 2, cause: { label: "nous:compte_deux_fois" } });
    const oneChunk = await keyOf(2, [[item("EF - cuivre DN 22", 12.345), item("EF cuivre DN 22", 12.345)]]);
    expect(oneChunk).toMatchObject({ status: "out_of_tolerance", items: 2, cause: { label: "indetermine", sign: "+" } });
  });

  it("says where an incomplete run stopped and after how many calls", () => {
    const stopped: BenchRunResult = {
      ...run([documentRun("a-plan-01", [call({ status: "stopped", error: { name: "StructuredAiError", code: "AI_QUOTA", message: "Limite du forfait ChatGPT atteinte." } })], [])], "incomplete"),
      stop: {
        kind: "provider", reason: "quota", error: { name: "StructuredAiError", code: "AI_QUOTA", message: "Limite du forfait ChatGPT atteinte." },
        calls_done: 1, calls_remaining: 7, at: { model: "fixture-model", reasoning_effort: "medium", pass: 1, document: "a-plan-01", chunk: 1 },
      },
    };
    const report = buildBenchReport({ metadata, run: stopped, scopes: buildScoreScopes(truthFiles, documents), noise: null });
    expect(report).toMatchObject({ status: "incomplete", stop: { reason: "quota", calls_done: 1, calls_remaining: 7 } });
    expect(renderBenchReportMarkdown(report)).toMatch(/quota[\s\S]*AI_QUOTA[\s\S]*1 appel[\s\S]*7 restant/);
  });
});
