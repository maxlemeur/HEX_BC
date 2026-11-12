// Ways the page triage run can fail, written before the code (TI-663). Decisions
// is injected; the real page reader renders fictional pdf-lib PDFs. The army
// journey covers one happy proposal and the reload cache; these cases cover:
// - one call for several pages, or another page's level/zone candidates (A);
// - an unchanged page called again, a correction lost, a failed page cached (D1, D2);
// - calls continuing after the first failed call (C2) or past the token ceiling (C1);
// - a Decisions limit exception escaping instead of a page to review (C4);
// - more calls in flight than the concurrency bound;
// - an unreadable PDF or a document above the page limit producing a partial triage (F5).
// Found in review, written before their fix:
// - a corrected page asked again (scope changed, or a failed page) loses « Corrigée »,
//   so the next acceptance overwrites the user's choice;
// - the triage usage restarts at the tokens of the last run instead of accumulating;
// - a page count that differs from the stored one is paid for, then dropped;
// - one unreadable page stops the reading of every later page;
// - a PDF whose every page is unreadable is saved as a proposal (second review).
// TI-715, before its fix: a page drawn over an embedded raster above the bound
// the reader decodes is excluded on a thumbnail that lacks that raster.
import { concatTransformationMatrix, drawObject, PDFDocument, PDFName, popGraphicsState, pushGraphicsState, StandardFonts, rgb } from "pdf-lib";
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

  it("sends a thumbnail that lacks an embedded image too large to read, but never excludes its page on it (TI-715)", { timeout: 60_000 }, async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    // Declared 16 MP, above the 8 MP the reader decodes; white, 1 bit, deflated to a few kilobytes.
    const raster = pdf.context.register(pdf.context.flateStream(new Uint8Array(500 * 4000).fill(0xff), {
      Type: "XObject", Subtype: "Image", Width: 4000, Height: 4000, ColorSpace: "DeviceGray", BitsPerComponent: 1,
    }));
    for (const withRaster of [true, false]) {
      const page = pdf.addPage([842, 595]);
      page.drawRectangle({ x: 60, y: 60, width: 700, height: 420, borderColor: rgb(0, 0, 0.8), borderWidth: 6 });
      if (withRaster) {
        page.node.setXObject(PDFName.of("Im0"), raster);
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(300, 0, 0, 200, 400, 200), drawObject("Im0"), popGraphicsState());
      }
      page.drawText("FACADE NORD - ELEVATION", { x: 80, y: 520, size: 18, font });
    }
    const seen: Array<Parameters<TakeoffPageTriageDecide>[0]> = [];
    const run = await base(new Uint8Array(await pdf.save()), async (input) => {
      seen.push(input);
      return answer(input);
    });
    expect(seen.map((input) => [input.evidence.page, input.images?.length])).toEqual([[1, 1], [2, 1]]);
    expect(run.calls.map((call) => [call.page, call.thumbnail?.blank, call.thumbnail?.dropped_images])).toEqual([[1, false, 1], [2, false, 0]]);
    expect(run.triage?.pages.map((page) => [page.page, page.type, page.proposal, page.reason])).toEqual([
      [1, "facade", "review", "thumbnail_missing"],
      [2, "facade", "exclude", null],
    ]);
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
    // Cumulative usage of the triage: the tokens that produced it, none added by the cache.
    expect(cached.triage).toMatchObject({ accepted: true, usage: { total_tokens: 10 } });
    expect(cached.triage?.pages[0].status).toBe("corrected");
    const failedBefore = { ...first.triage!, pages: first.triage!.pages.map((page) => page.page === 2 ? { ...page, proposal: "review" as const, status: "to_review" as const, reason: "call_failed" as const } : page) };
    calls = 0;
    const retried = await base(bytes, decide, { previous: failedBefore });
    expect(calls).toBe(1);
    expect(retried.triage?.pages[1]).toMatchObject({ proposal: "keep", reason: null });
    expect(retried.triage?.accepted).toBe(false);
  });

  it("offers a free level of the scope on the page that prints it and stores the answer as written (TI-687)", async () => {
    const seen: Array<Parameters<TakeoffPageTriageDecide>[0]> = [];
    const decide: TakeoffPageTriageDecide = async (input) => {
      seen.push(input);
      const result = answer(input);
      return { ...result, answers: result.answers.map((entry) => entry.name === "page_level" ? { ...entry, value: "L00" } : entry) };
    };
    const bytes = await fictionalPdf(["DATA HALL L00 PLUMBING", "DATA HALL GANTRY CHW"]);
    const scope = { levels: ["L00", "L01"], zones: [] };
    const run = await base(bytes, decide, { scope });
    const choices = (page: number) => {
      const question = seen.find((input) => input.evidence.page === page)!.questions.find((entry) => entry.name === "page_level");
      return question?.type === "choice" ? question.choices.map((choice) => choice.value) : null;
    };
    expect(choices(1)).toEqual(["L00", "inconnu"]);
    expect(choices(2)).toBeNull();
    expect(run.triage?.pages.map((page) => [page.page, page.level])).toEqual([[1, "L00"], [2, null]]);
    // The declared labels are part of the triage identity; a scope of known levels keeps the identity it had.
    const other = await base(bytes, decide, { scope: { levels: ["L00", "GANTRY"], zones: [] } });
    expect(other.triage?.questions_fingerprint).not.toBe(run.triage?.questions_fingerprint);
    const known = await base(bytes, decide, { scope: { levels: ["R+1"], zones: [] } });
    const sameKnown = await base(bytes, decide, { scope: { levels: ["Niveau R+1", "Tous les niveaux du lot"], zones: [] } });
    expect(sameKnown.triage?.questions_fingerprint).toBe(known.triage?.questions_fingerprint);
  });

  it("keeps a correction on a page that is asked again", async () => {
    const bytes = await fictionalPdf(["FACADE NORD", "PLAN R+1 Zone 1"]);
    const decide: TakeoffPageTriageDecide = async (input) => answer(input);
    const first = await base(bytes, decide);
    const corrected = { ...first.triage!, accepted: true, pages: first.triage!.pages.map((page) => page.page === 1 ? { ...page, status: "corrected" as const } : page) };
    const rerun = await base(bytes, decide, { previous: corrected, scope: { levels: ["R+2"], zones: [] } });
    expect(rerun.calls.map((call) => call.status)).toEqual(["available", "available"]);
    expect(rerun.triage?.pages.map((page) => [page.proposal, page.status])).toEqual([["exclude", "corrected"], ["keep", "proposed"]]);
    expect(rerun.triage?.usage.total_tokens).toBe(20);
  });

  it("refuses a page count different from the stored one before any call", async () => {
    let calls = 0;
    const run = await base(await fictionalPdf(["A", "B"]), async (input) => { calls += 1; return answer(input); }, { expectedPageCount: 3 });
    expect(run).toMatchObject({ triage: null, stop: { reason: "page_count_mismatch" } });
    expect(calls).toBe(0);
  });

  it("reads the pages after an unreadable one and leaves only that page to review", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const broken = pdf.addPage([400, 300]);
    broken.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.stream("BT /F9 12 Tf 20 20 Td (broken) Tj ET /Im9 Do")));
    const plan = pdf.addPage([400, 300]);
    plan.drawText("PLAN R+1", { x: 20, y: 250, size: 14, font });
    plan.drawLine({ start: { x: 0, y: 0 }, end: { x: 400, y: 300 }, thickness: 3, color: rgb(1, 0, 0) });
    let calls = 0;
    const run = await base(new Uint8Array(await pdf.save()), async (input) => { calls += 1; return answer(input); });
    expect(calls).toBe(1);
    expect(run.triage?.pages.map((page) => [page.page, page.proposal, page.reason])).toEqual([[1, "review", "render_failed"], [2, "keep", null]]);
  });

  it("returns no triage when every page is unreadable", async () => {
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 2; index += 1) {
      const broken = pdf.addPage([400, 300]);
      broken.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.stream("BT /F9 12 Tf 20 20 Td (broken) Tj ET /Im9 Do")));
    }
    let calls = 0;
    const run = await base(new Uint8Array(await pdf.save()), async (input) => { calls += 1; return answer(input); });
    expect(run).toMatchObject({ triage: null, stop: { reason: "render_failed" } });
    expect(calls).toBe(0);
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
