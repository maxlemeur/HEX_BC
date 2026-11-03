// Ways the page triage run can fail, written before the code (TI-663). Decisions
// is injected; the real page reader renders fictional pdf-lib PDFs. The army
// journey covers one happy proposal and the reload cache; these cases cover:
// - one call for several pages, or another page's level/zone candidates (A);
// - an unchanged page called again, a correction lost, a failed page cached (D1, D2);
// - calls continuing after the first failed call (C2) or past the token ceiling (C1);
// - a Decisions limit exception escaping instead of a page to review (C4);
// - more calls in flight than the concurrency bound;
// - an unreadable PDF or a document above the page limit producing a partial triage (F5).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { OpenAiDecisionsResult } from "@/lib/ai/decisions";
import { createDecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import { runTakeoffPageTriage, type TakeoffPageTriageDecide } from "@/lib/takeoff/page-triage-server";

const owner = { tenantId: "tenant-a", userId: "user-a" };

async function fictionalPdf(pages: string[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const label of pages) {
    const page = pdf.addPage([842, 595]);
    page.drawRectangle({ x: 60, y: 60, width: 700, height: 420, borderColor: rgb(0, 0, 0.8), borderWidth: 6 });
    page.drawLine({ start: { x: 60, y: 300 }, end: { x: 760, y: 300 }, thickness: 4, color: rgb(0.8, 0, 0) });
    page.drawText(label, { x: 80, y: 520, size: 18, font });
  }
  return new Uint8Array(await pdf.save());
}

function answer(input: Parameters<TakeoffPageTriageDecide>[0], usage = 5): OpenAiDecisionsResult {
  const text = String(input.evidence.page_text ?? "");
  const facade = /FA[ÇC]ADE/.test(text);
  return {
    status: "available", capability: { status: "available", model: "gpt-6-luna", billing: "separate_api", message: "" }, message: "",
    answers: input.questions.map((question) => ({
      name: question.name, type: question.type, status: "answered" as const, confidence: 0.95,
      value: question.name === "page_type" ? (facade ? "facade" : "reseau") : question.name === "page_level" ? "R+1" : "Z1",
    })),
    provenance: { tenant_id: owner.tenantId, project_id: "project-a", preparation_fingerprint: "p", request_fingerprint: "r", model: "gpt-6-luna",
      requested_at: "2026-11-03T10:00:00.000Z", usage: { input_tokens: usage, output_tokens: 0, total_tokens: usage } },
  };
}

function base(bytes: Uint8Array, decide: TakeoffPageTriageDecide, extra: Partial<Parameters<typeof runTakeoffPageTriage>[0]> = {}) {
  return runTakeoffPageTriage({
    owner, projectId: "project-a", bytes, fileName: "Façade et plan.pdf", sourceVersion: "v1",
    scope: { levels: [], zones: [] }, previous: null, budget: createDecisionsTokenBudget(100_000, 1000), decide, ...extra,
  });
}

describe("page triage run", () => {
  it("asks one call per page with that page's candidates and proposes the facade exclusion", async () => {
    const seen: Array<Parameters<TakeoffPageTriageDecide>[0]> = [];
    const run = await base(await fictionalPdf(["FACADE NORD - ELEVATION", "PLAN PLOMBERIE R+1 Zone 1"]), async (input) => {
      seen.push(input);
      return answer(input);
    });
    expect(seen).toHaveLength(2);
    const byPage = (page: number) => seen.find((input) => input.evidence.page === page)!;
    expect(byPage(1).questions.map((question) => question.name)).toEqual(["page_type"]);
    expect(byPage(2).questions.map((question) => question.name)).toEqual(["page_type", "page_level", "page_zone"]);
    expect(seen.every((input) => input.images?.length === 1)).toBe(true);
    expect(run.triage?.pages.map((page) => [page.page, page.type, page.level, page.zone, page.proposal, page.status])).toEqual([
      [1, "facade", null, null, "exclude", "proposed"],
      [2, "reseau", "R+1", "Z1", "keep", "proposed"],
    ]);
    expect(run.triage?.usage.total_tokens).toBe(10);
    expect(run.stop).toBeNull();
  });

  it("reuses unchanged pages without a call, keeps a correction, and asks again for a failed page", async () => {
    const bytes = await fictionalPdf(["FACADE NORD", "PLAN R+1 Zone 1"]);
    let calls = 0;
    const decide: TakeoffPageTriageDecide = async (input) => { calls += 1; return answer(input); };
    const first = await base(bytes, decide);
    const corrected = { ...first.triage!, accepted: true, pages: first.triage!.pages.map((page) => page.page === 1 ? { ...page, status: "corrected" as const } : page) };
    calls = 0;
    const cached = await base(bytes, decide, { previous: corrected });
    expect(calls).toBe(0);
    expect(cached.calls.map((call) => call.status)).toEqual(["cached", "cached"]);
    expect(cached.triage).toMatchObject({ accepted: true, usage: { total_tokens: 0 } });
    expect(cached.triage?.pages[0].status).toBe("corrected");
    const failedBefore = { ...first.triage!, pages: first.triage!.pages.map((page) => page.page === 2 ? { ...page, proposal: "review" as const, status: "to_review" as const, reason: "call_failed" as const } : page) };
    calls = 0;
    const retried = await base(bytes, decide, { previous: failedBefore });
    expect(calls).toBe(1);
    expect(retried.triage?.pages[1]).toMatchObject({ proposal: "keep", reason: null });
    expect(retried.triage?.accepted).toBe(false);
  });

  it("stops at the first failed call and leaves the remaining pages to review", async () => {
    let calls = 0;
    const run = await base(await fictionalPdf(["FACADE", "PLAN R+1"]), async (input) => {
      calls += 1;
      return { ...answer(input), status: "failed", answers: [], message: "La limite API Decisions est atteinte.", provenance: { ...answer(input).provenance, usage: null } };
    }, { concurrency: 1 });
    expect(calls).toBe(1);
    expect(run.triage?.pages.map((page) => [page.proposal, page.reason])).toEqual([["review", "call_failed"], ["review", "stopped"]]);
    expect(run.stop).toMatchObject({ reason: "call_failed" });
    expect(run.calls.map((call) => call.status)).toEqual(["failed", "skipped"]);
  });

  it("stops before exceeding the token ceiling", async () => {
    let calls = 0;
    const run = await base(await fictionalPdf(["FACADE", "PLAN R+1"]), async (input) => { calls += 1; return answer(input, 8); },
      { concurrency: 1, budget: createDecisionsTokenBudget(10, 8) });
    expect(calls).toBe(1);
    expect(run.triage?.pages[1]).toMatchObject({ proposal: "review", reason: "budget_reached" });
    expect(run.stop).toMatchObject({ reason: "budget_reached" });
  });

  it("turns a Decisions limit exception into pages to review without stopping", async () => {
    const run = await base(await fictionalPdf(["FACADE", "PLAN R+1"]), async () => { throw new Error("Les aperçus Decisions dépassent la taille autorisée."); });
    expect(run.triage?.pages.map((page) => [page.proposal, page.reason])).toEqual([["review", "exception"], ["review", "exception"]]);
    expect(run.stop).toBeNull();
  });

  it("keeps the number of calls in flight under the concurrency bound", async () => {
    let inFlight = 0;
    let peak = 0;
    await base(await fictionalPdf(["A", "B", "C", "D", "E", "F"]), async (input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return answer(input);
    }, { concurrency: 2 });
    expect(peak).toBe(2);
  });

  it("returns no triage for an unreadable PDF or a document above the page limit", async () => {
    let calls = 0;
    const decide: TakeoffPageTriageDecide = async (input) => { calls += 1; return answer(input); };
    const unreadable = await base(new TextEncoder().encode("%PDF-1.7\nnot a pdf\n%%EOF"), decide);
    expect(unreadable).toMatchObject({ triage: null, stop: { reason: "render_failed" } });
    const tooLong = await base(await fictionalPdf(["A", "B"]), decide, { maxPages: 1 });
    expect(tooLong).toMatchObject({ triage: null, stop: { reason: "page_limit" } });
    expect(calls).toBe(0);
  });
});
