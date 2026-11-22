import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { extractLevelCChunkMetricsFromError } from "@/lib/takeoff/level-c-chunk-metrics";
import type { Poste } from "@/lib/takeoff/poste-list";
import {
  finishPlanReading,
  posteVectorReadings,
  readPlanAgainstItemList,
  type PosteReadingReference,
} from "@/lib/takeoff/poste-reading";
import { controlledPosteCall, posteMeasured, posteNotFound, readPosteManifest } from "@/lib/takeoff/poste-reading.test-fixtures";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

function poste(index: number, label: string, expectedUnit = "u", qualifiers: Poste["qualifiers"] = {}): Poste {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, label, expectedUnit, measurementBasis: null, qualifiers,
    sections: [], synonyms: [], referenceQuantity: 9876.5,
    origin: { kind: "manual", intentId: `i-${index}`, addedBy: "u-1", addedAt: "2026-11-22T08:00:00.000Z", addedInRevision: 1 } };
}

const LAVABO = poste(1, "Lavabo");
const WC = poste(2, "WC suspendu");
const EF = poste(3, "Distribution EF", "ml", { network: "EF", material: "cuivre", diameter: "DN 22" });
const ITEMS = [LAVABO, WC, EF];
const CONFIG = { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2, timeoutMs: 300_000, maxTotalTokens: 400_000,
  maxCostCents: 2_500 };
const JOB = { id: "99999999-9999-4999-8999-999999999999", tenant_id: "88888888-8888-4888-8888-888888888888" };

async function plan(pages: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) pdf.addPage([595, 842]);
  const bytes = await pdf.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const DPGF_ROWS = "Lavabo;9876,5;u;120,00 €";
const REFERENCES: PosteReadingReference[] = [
  { kind: "dpgf", name: "DPGF plomberie.xlsx", revision: "A", data: Buffer.from(DPGF_ROWS, "utf8").toString("base64"), mimeType: "text/csv" },
  { kind: "cctp", name: "CCTP plomberie.pdf", revision: "B", data: Buffer.from("%PDF-1.4 cctp").toString("base64"),
    mimeType: "application/pdf" },
];

/** A plan of 20 retained pages, the original pages 101 to 120 of its file: fragments 1–10, 9–18, 17–20. */
async function read(call = controlledPosteCall(), items = ITEMS) {
  return readPlanAgainstItemList({ call, job: JOB, items, listRevision: 5, model: "controlled", config: CONFIG,
    pdf: { fileName: "Plan RDC.pdf", bytes: await plan(20), originalPageNumbers: Array.from({ length: 20 }, (_, index) => 101 + index) },
    references: REFERENCES });
}

describe("readPlanAgainstItemList", () => {
  it("reads a plan against its list, fragment by fragment, through the local reader's call", async () => {
    const call = controlledPosteCall((entry) => {
      if (entry.label === "Lavabo" && entry.chunkId === "f1-b1") return posteMeasured(entry, [{ page: 2, quantity: 3 }]);
      if (entry.label === "Lavabo" && entry.chunkId === "f3-b1") return posteMeasured(entry, [{ page: 3, quantity: 2 }]);
      return posteNotFound(entry);
    });
    const reading = await read(call);
    const { answers } = finishPlanReading(reading, ITEMS, []);

    expect(call.received.map((entry) => entry.chunkId)).toEqual(["f1-b1", "f2-b1", "f3-b1"]);
    expect(reading).toMatchObject({ calls: 3, pageCount: 20, chunksCount: 3, planPages: Array.from({ length: 20 }, (_, i) => 101 + i) });
    expect(answers.map((answer) => [answer.itemId, answer.outcome, answer.quantity])).toEqual([
      [LAVABO.id, "measured", { value: 5, unit: "u" }], [WC.id, "not_found", null], [EF.id, "not_found", null]]);
    // The plan's original pages: fragment 1's page 2 is page 102; fragment 3's page 3 is the PDF's page 19, page 119.
    expect(answers[0].observations.map((entry) => entry.page)).toEqual([102, 119]);
    expect(reading.metrics.map((metric) => [metric.index, metric.start, metric.end, metric.status])).toEqual([
      [0, 1, 10, "success"], [1, 9, 18, "success"], [2, 17, 20, "success"]]);
    expect(reading.tokenUsage.totalTokens).toBe(3_000);
  });

  it("attaches the fragment and only the written technical pieces, never the DPGF, its figures or an identifier", async () => {
    const call = controlledPosteCall();
    await read(call);

    for (const received of call.received) {
      expect(received.files.map((file) => file.mimeType)).toEqual(["application/pdf", "application/pdf"]);
      expect(Buffer.from(received.files[0].data, "base64").toString()).toBe("%PDF-1.4 cctp");
      expect(received.prompt).toContain("CCTP plomberie.pdf");
      expect(received.prompt).not.toMatch(/DPGF plomberie|9876|120,00|00000000-0000-4000-8000|99999999-|88888888-/u);
    }
    const fragment = await PDFDocument.load(Buffer.from(call.received[2].files[1].data, "base64"));
    expect(fragment.getPageCount()).toBe(4);
  });

  it("asks a long list in batches, each item keeping its key over the plan", async () => {
    const items = Array.from({ length: 41 }, (_, index) => poste(100 + index, `Poste ${index}`));
    const call = controlledPosteCall();
    const reading = await read(call, items);

    expect(call.received.map((entry) => entry.chunkId)).toEqual(["f1-b1", "f1-b2", "f2-b1", "f2-b2", "f3-b1", "f3-b2"]);
    expect(readPosteManifest(call.received[5].prompt).requested_posts.map((entry) => entry.post_id)).toEqual(["P0041"]);
    expect(finishPlanReading(reading, items, []).answers).toHaveLength(41);
  });

  it("stops the plan at the first answer that misses an item, before any other call and before anything is published", async () => {
    const call = controlledPosteCall((entry) => entry.chunkId === "f2-b1" && entry.label === "WC suspendu" ? "omit" : posteNotFound(entry));
    const failure = await read(call).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TakeoffError);
    expect(failure).toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA, retryable: false,
      details: { reason: "MISSING_ANSWER", chunk_id: "f2-b1", keys: ["P0002"] } });
    expect((failure as TakeoffError).message).toMatch(/1 poste demandé sans réponse/);
    expect(call.received.map((entry) => entry.chunkId)).toEqual(["f1-b1", "f2-b1"]);
    expect(extractLevelCChunkMetricsFromError(failure).map((metric) => [metric.index, metric.status])).toEqual([[0, "success"], [1, "failed"]]);
  });

  it("refuses an answer of the first format or of another version as an invalid answer", async () => {
    const first = controlledPosteCall(posteNotFound, { alter: (output) => ({ items: [], warnings: [], metadata: output }) });
    await expect(read(first)).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA });
    // A schema failure of the local reader carries the tokens it consumed: the call's metric keeps them.
    const spent = Object.assign(new Error("schema"), { name: "ZodError", usage: { inputTokens: 700, reasoningTokens: 0, outputTokens: 50,
      totalTokens: 750 } });
    const failure = await readPlanAgainstItemList({ call: async () => { throw spent; }, job: JOB, items: ITEMS, listRevision: 5,
      model: "controlled", config: CONFIG, pdf: { fileName: "Plan RDC.pdf", bytes: await plan(4) } }).catch((error: unknown) => error);
    expect(extractLevelCChunkMetricsFromError(failure).map((metric) => [metric.status, metric.token_count])).toEqual([["failed", 750]]);
    const version = controlledPosteCall(posteNotFound, { alter: (output) => ({ ...output, prompt_version: "takeoff-c-v1" }) });
    await expect(read(version)).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA });
    const other = controlledPosteCall(posteNotFound, { alter: (output) => ({ ...output, chunk_id: "f9-b1" }) });
    await expect(read(other)).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
      details: { reason: "OUTPUT_VERSION" } });
  });

  it("stops at the budget of the detailed reading like the first format", async () => {
    const call = controlledPosteCall(posteNotFound, { totalTokens: 150_000 });
    const failure = await read(call).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED });
    expect(call.received).toHaveLength(3);
  });

  it("checks the lease and the tenant before every call", async () => {
    const order: string[] = [];
    const call = controlledPosteCall((entry) => {
      order.push(`call:${entry.chunkId}`);
      return posteNotFound(entry);
    });
    await readPlanAgainstItemList({ call, job: JOB, items: [LAVABO], listRevision: 5, model: "controlled", config: CONFIG,
      pdf: { fileName: "Plan RDC.pdf", bytes: await plan(20) }, beforeCall: async () => { order.push("check"); } });

    expect(order).toEqual(["check", "call:f1-b1", "check", "call:f2-b1", "check", "call:f3-b1"]);
  });
});

describe("posteVectorReadings and finishPlanReading", () => {
  it("attaches the vector reading of the plan's own pages, as an alternative of the model's measure", async () => {
    const call = controlledPosteCall((entry) => entry.label === "Distribution EF" && entry.chunkId === "f1-b1"
      ? posteMeasured(entry, [{ page: 3, quantity: 12.5, unit: "ml" }]) : posteNotFound(entry));
    const reading = await read(call);
    const network = (page: number, quantity: number, planFileId = "plan-a", read = true): VectorPageOutcome => ({
      document: { kind: "plan_file", plan_file_id: planFileId }, fileName: "Plan RDC.pdf", page, record: read ? {} as never : null,
      error: null,
      items: [{ item: { designation: "EF cuivre DN 22", quantity, unit: "ml", confidence: 0.9, evidence: "Lecture vectorielle", category: "réseau" },
        geometry: { schema_version: 1, kind: "network", network: "EF", material: "cuivre", dn: 22, zone: null, level: null, groups: [],
          segments_m: [], polygon_m: null, length_m: quantity, area_m2: null, transform: null } as never }],
    });
    // Another plan's page and a page whose vector reading failed (nothing persisted for it) give no reading.
    const vectors = posteVectorReadings([network(103, 12.55), network(103, 80, "plan-b"), network(250, 4), network(104, 9, "plan-a", false)],
      "plan-a");

    expect(vectors.map((entry) => [entry.key, entry.page, entry.quantity])).toEqual([["plan-a:103:0", 103, 12.55], ["plan-a:250:0", 250, 4]]);
    const { answers, unattachedVectorReadings } = finishPlanReading(reading, ITEMS, vectors);
    expect(answers[2]).toMatchObject({ outcome: "measured", quantity: { value: 12.5, unit: "ml" } });
    expect(answers[2].observations.map((entry) => [entry.page, entry.role, entry.source])).toEqual([[103, "contribution", "model"],
      [103, "alternative", "vector"]]);
    // A page of another plan's reading never reaches this one.
    expect(unattachedVectorReadings).toEqual([]);
  });

  it("turns a refusal of the merged plan into the plan's explicit error", async () => {
    const reading = await read();
    expect(() => finishPlanReading({ ...reading, fragments: reading.fragments.slice(0, 2) }, ITEMS, []))
      .toThrow(expect.objectContaining({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
        details: expect.objectContaining({ reason: "UNPROCESSED_PAGES", chunk_id: "plan" }) }));
  });
});
