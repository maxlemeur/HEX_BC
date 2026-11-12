// Ways the bench page triage (TI-663) could publish a wrong result, written
// before the code:
// - documents keep being triaged after the first failed Decisions call, or past
//   the token ceiling (C2, C3); a failed call counted as a measurement (H3);
// - the context is not the bench one (projectId bench:<id>, plan SHA as source),
//   the file name or an empty scope differs from the « Mes documents » step;
// - a kept page (garder) proposed excluded is not reported as a false exclusion;
// - an ambiguous page enters the per-type precision, or a failed call does;
// - reserve pages mix with the others, or tune the threshold (H1): the threshold
//   needed for a 100 % recall is computed outside the reserve, never below 0.8.
// Found in review, written before their fix: a page the rule could not exclude
// (partial call, blank thumbnail) raises the threshold; a confidence of 1 reports
// a threshold of 1 that still excludes; pages never run count as kept, and so do
// pages skipped after a stop (second review); an unreadable page stays kept.
import { describe, expect, it } from "vitest";

import { createDecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import type { ManifestDocument, PageTruthFile } from "@/lib/takeoff/bench/schemas";
import { runTakeoffBenchTriage, scoreTakeoffBenchTriage, type BenchTriageDocument } from "@/lib/takeoff/bench/triage";
import type { TakeoffPageTriageCall, TakeoffPageTriageRun } from "@/lib/takeoff/page-triage-server";

const owner = { userId: "user-a", tenantId: "tenant-a" };

function manifestDocument(id: string, role: ManifestDocument["role"] = "no_truth"): ManifestDocument {
  return { id, lot: id.slice(0, 1) as ManifestDocument["lot"], kind: "plan", drive_id: "fictional", original_title: `${id} fictif.pdf`, project: null,
    file_type: "pdf", file_size: 10, modified_time: "2026-11-01T00:00:00.000Z", raw_status: "binary", raw_path: `raw/${id}.pdf`,
    sha256: "c".repeat(64), structure_check: { status: "passed", method: "fixture", detail: null }, pages: 1, format: null, scale: null,
    index: null, vector: null, ocg_count: null, level: null, zone: null, role, duplicate_of: null, notes: null } as ManifestDocument;
}

function truth(id: string, type: string, garder: boolean, statut = "à valider"): PageTruthFile {
  return { schema_version: 1, document: id, page_count: 1, labeled_at: "2026-11-03",
    pages: [{ page: 1, type, niveau: null, zone: null, garder, statut, labeled_by: "agent" }] } as PageTruthFile;
}

function call(type: string | null, confidence: number | null, proposal: TakeoffPageTriageCall["proposal"], status: TakeoffPageTriageCall["status"] = "available"): TakeoffPageTriageCall {
  return { page: 1, status, duration_ms: 1000, render_ms: 200, usage: status === "available" ? { input_tokens: 90, output_tokens: 10, total_tokens: 100 } : null,
    request_fingerprint: "d".repeat(64), answers: { type: type ? { status: "answered", value: type, confidence } : null, level: null, zone: null },
    proposal, reason: proposal === "review" ? "low_confidence" : null, thumbnail: { width: 1200, height: 800, bytes: 1000, blank: false, dropped_images: 0 }, text_chars: 10, message: null };
}

function run(calls: TakeoffPageTriageCall[], stop: TakeoffPageTriageRun["stop"] = null): TakeoffPageTriageRun {
  return { triage: null, run_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, calls,
    render: { status: "complete", page_count: calls.length, duration_ms: 300, timed_out: false, canvas_available: true }, stop };
}

const doc = (id: string, role: ManifestDocument["role"], page: PageTruthFile) => ({ document: manifestDocument(id, role), bytes: Buffer.from("%PDF"), truth: page });

describe("bench page triage run", () => {
  it("uses the bench context and an empty scope, and stops at the first failed call", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const result = await runTakeoffBenchTriage({
      documents: [doc("e-plan-01", "no_truth", truth("e-plan-01", "reseau", true)), doc("e-plan-02", "no_truth", truth("e-plan-02", "coupe", false)), doc("e-plan-03", "no_truth", truth("e-plan-03", "reseau", true))],
      owner, budget: createDecisionsTokenBudget(1000, 100),
      triage: async (input) => {
        seen.push({ projectId: input.projectId, fileName: input.fileName, sourceVersion: input.sourceVersion, scope: input.scope, deadline: input.deadlineMs, stop: input.stopOnFailure, previous: input.previous });
        return seen.length === 2 ? run([call(null, null, "review", "failed")], { reason: "call_failed", message: "429" }) : run([call("reseau", 0.95, "keep")]);
      },
    });
    expect(seen[0]).toEqual({ projectId: "bench:e-plan-01", fileName: "e-plan-01 fictif.pdf", sourceVersion: "c".repeat(64), scope: { levels: [], zones: [] }, deadline: Number.POSITIVE_INFINITY, stop: true, previous: null });
    expect(seen).toHaveLength(2);
    expect(result).toMatchObject({ status: "incomplete", stop: { reason: "call_failed", document: "e-plan-02" } });
    expect(result.documents.map((entry) => entry.status)).toEqual(["done", "done", "not_run"]);
  });

  it("stops when the shared token ceiling refuses a call", async () => {
    const result = await runTakeoffBenchTriage({
      documents: [doc("e-plan-01", "no_truth", truth("e-plan-01", "reseau", true)), doc("e-plan-02", "no_truth", truth("e-plan-02", "reseau", true))],
      owner, budget: createDecisionsTokenBudget(1000, 100),
      triage: async () => run([{ ...call(null, null, "review", "skipped"), reason: "budget_reached" }], { reason: "budget_reached", message: "ceiling" }),
    });
    expect(result).toMatchObject({ status: "incomplete", stop: { reason: "budget_reached", document: "e-plan-01" } });
    expect(result.documents.map((entry) => entry.status)).toEqual(["done", "not_run"]);
  });

  // Codex review of PR #144 (P2), written before the fix: a document the renderer refuses (over the
  // page limit, unreadable) had no page classified, yet the run reported « complete » with no stop.
  it("reports a run incomplete when the renderer refuses a document, and still triages the next ones", async () => {
    const refused = (reason: "page_limit" | "render_failed") => ({ ...run([], { reason, message: `refused: ${reason}` }),
      render: { status: "failed" as const, page_count: null, duration_ms: 10, timed_out: false, canvas_available: true } });
    let calls = 0;
    const result = await runTakeoffBenchTriage({
      documents: [doc("e-plan-01", "no_truth", truth("e-plan-01", "reseau", true)), doc("e-plan-02", "no_truth", truth("e-plan-02", "reseau", true)), doc("e-plan-03", "no_truth", truth("e-plan-03", "reseau", true))],
      owner, budget: createDecisionsTokenBudget(1000, 100),
      triage: async () => {
        calls += 1;
        if (calls === 1) return refused("page_limit") as unknown as TakeoffPageTriageRun;
        if (calls === 2) return refused("render_failed") as unknown as TakeoffPageTriageRun;
        return run([call("reseau", 0.95, "keep")]);
      },
    });
    expect(calls).toBe(3);
    expect(result.status).toBe("incomplete");
    expect(result.stop).toBeNull();
    expect(result.failures).toEqual([
      { reason: "page_limit", message: "refused: page_limit", document: "e-plan-01" },
      { reason: "render_failed", message: "refused: render_failed", document: "e-plan-02" },
    ]);
    expect(result.documents.map((entry) => entry.status)).toEqual(["done", "done", "done"]);
  });
});

describe("bench page triage score", () => {
  const documents: BenchTriageDocument[] = [
    { ...doc("a-plan-01", "truth", truth("a-plan-01", "reseau", true)), status: "done", run: run([call("reseau", 0.97, "keep")]) },
    { ...doc("e-plan-20", "no_truth", truth("e-plan-20", "coupe", false)), status: "done", run: run([call("coupe", 0.93, "exclude")]) },
    // A kept page read as a facade with 0.86: a false exclusion that needs a threshold above 0.86.
    { ...doc("d-plan-01", "truth", truth("d-plan-01", "architecture", true)), status: "done", run: run([call("facade", 0.86, "exclude")]) },
    { ...doc("e-plan-21", "no_truth", truth("e-plan-21", "masse", true, "ambigu")), status: "done", run: run([call("reseau", 0.9, "keep")]) },
    { ...doc("e-plan-22", "no_truth", truth("e-plan-22", "toiture", false)), status: "done", run: run([call(null, null, "review", "failed")]) },
    // Reserve: a false exclusion at 0.99 must not move the threshold.
    { ...doc("a-plan-02", "reserve", truth("a-plan-02", "reseau", true)), status: "done", run: run([call("coupe", 0.99, "exclude")]) },
  ];

  it("reports false exclusions, per-type precision without ambiguous or failed pages, and the reserve apart", () => {
    const score = scoreTakeoffBenchTriage(documents);
    expect(score.main.false_exclusions).toEqual([{ document: "d-plan-01", page: 1, truth_type: "architecture", type: "facade", confidence: 0.86 }]);
    expect(score.main.kept_recall).toEqual({ kept_pages: 3, wrongly_excluded: 1, recall: 2 / 3, not_run_kept: 0 });
    expect(score.main.per_type.coupe).toEqual({ predicted: 1, correct: 1, truth: 1, precision: 1, recall: 1 });
    expect(score.main.per_type.facade).toEqual({ predicted: 1, correct: 0, truth: 0, precision: 0, recall: null });
    expect(score.main.per_type.reseau).toEqual({ predicted: 1, correct: 1, truth: 1, precision: 1, recall: 1 });
    expect(score.main.pages).toMatchObject({ total: 5, answered: 4, failed: 1, ambiguous: 1 });
    expect(score.main.required_threshold).toBe(0.87);
    expect(score.reserve.false_exclusions).toHaveLength(1);
    expect(score.reserve.required_threshold).toBe(1);
    expect(score.main.kept_recall).toMatchObject({ not_run_kept: 0 });
    expect(score.main.tokens).toEqual({ input: 360, output: 40, total: 400, calls: 5, calls_without_usage: 1 });
  });

  it("computes the threshold only from pages the rule could exclude, and none above a confidence of 1", () => {
    const partial = { ...call("facade", 0.97, "review", "partial"), reason: "partial_answer" as const };
    const blank = { ...call("coupe", 0.98, "review"), reason: "thumbnail_missing" as const, thumbnail: { width: 1200, height: 800, bytes: 4000, blank: true, dropped_images: 0 } };
    // TI-715: drawn, but without an embedded image too large to read.
    const lacking = { ...call("coupe", 0.99, "review"), reason: "thumbnail_missing" as const, thumbnail: { width: 1200, height: 800, bytes: 9000, blank: false, dropped_images: 1 } };
    const certain = call("coupe", 1, "exclude");
    const score = (entry: ReturnType<typeof call>) => scoreTakeoffBenchTriage([{ ...doc("a-plan-01", "truth", truth("a-plan-01", "reseau", true)), status: "done", run: run([entry]) }]).main.required_threshold;
    expect([score(partial), score(blank), score(lacking), score(certain)]).toEqual([0.8, 0.8, 0.8, null]);
  });

  it("leaves pages never run out of the kept recall", () => {
    const score = scoreTakeoffBenchTriage([
      { ...doc("a-plan-01", "truth", truth("a-plan-01", "reseau", true)), status: "done", run: run([call("reseau", 0.97, "keep")]) },
      { ...doc("e-plan-01", "no_truth", truth("e-plan-01", "reseau", true)), status: "not_run", run: null },
    ]).main;
    expect(score.kept_recall).toEqual({ kept_pages: 1, wrongly_excluded: 0, recall: 1, not_run_kept: 1 });
  });

  it("counts pages skipped after a stop as not run, and an unreadable page as kept", () => {
    const skipped = (reason: "stopped" | "budget_reached" | "render_failed") => ({ ...call(null, null, "review", "skipped"), reason, usage: null, duration_ms: null });
    const score = scoreTakeoffBenchTriage([
      { ...doc("e-plan-01", "no_truth", truth("e-plan-01", "reseau", true)), status: "done", run: run([skipped("stopped")]) },
      { ...doc("e-plan-02", "no_truth", truth("e-plan-02", "reseau", true)), status: "done", run: run([skipped("budget_reached")]) },
      { ...doc("e-plan-03", "no_truth", truth("e-plan-03", "reseau", true)), status: "done", run: run([skipped("render_failed")]) },
    ]).main;
    expect(score.kept_recall).toEqual({ kept_pages: 1, wrongly_excluded: 0, recall: 1, not_run_kept: 2 });
    expect(score.pages).toMatchObject({ total: 3, not_run: 2 });
  });

  it("keeps the threshold at 0.8 when no kept page is excluded", () => {
    const clean = documents.filter((entry) => entry.document.id !== "d-plan-01");
    expect(scoreTakeoffBenchTriage(clean).main).toMatchObject({ required_threshold: 0.8, kept_recall: { recall: 1 } });
  });
});
