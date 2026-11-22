import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/level-c-reading", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/level-c-reading")>(),
  // The first format's checks before a paid call (tested with it): here the page count and the detailed configuration.
  prepareLevelCReading: vi.fn(async (input: { sourceFile: { bytes: ArrayBuffer } }) => ({
    pageCount: (await PDFDocument.load(input.sourceFile.bytes)).getPageCount(),
    config: { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2, maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000,
      maxCostCents: 2_500 } })),
}));
vi.mock("@/lib/takeoff/processing-audit", () => ({ logCompletedAuditEvent: vi.fn() }));
vi.mock("@/lib/takeoff/rules/recompute-server", () => ({ isTakeoffRulesEnabled: () => true, recomputeTakeoffRulesQuietly: vi.fn() }));
vi.mock("@/lib/takeoff/poste-publication-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/poste-publication-server")>(), publishTakeoffItemAnswers: vi.fn(),
}));

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { readSealedItemListItems } from "@/lib/takeoff/item-list-server";
import { itemListEntries } from "@/lib/takeoff/item-list";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { createSupabaseFake, servedRows, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { POSTE_EXCHANGE_PROMPT_VERSION } from "@/lib/takeoff/poste-exchange";
import type { Poste } from "@/lib/takeoff/poste-list";
import { logCompletedAuditEvent } from "@/lib/takeoff/processing-audit";
import { buildTakeoffItemAnswersPublication, publishTakeoffItemAnswers } from "@/lib/takeoff/poste-publication-server";
import { finishPlanReading, posteVectorReadings, readPlanAgainstItemList } from "@/lib/takeoff/poste-reading";
import { processItemListLevelC, readTakeoffItemListOrder } from "@/lib/takeoff/poste-reading-job-server";
import { controlledPosteCall, posteMeasured, posteNotFound } from "@/lib/takeoff/poste-reading.test-fixtures";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

const TENANT = "aaaaaaaa-0000-4000-8000-000000000010";
const PROJECT = "aaaaaaaa-0000-4000-8000-000000000020";
const REQUEST = "aaaaaaaa-0000-4000-8000-000000000030";
const JOB = "aaaaaaaa-0000-4000-8000-000000000040";
const PLAN = "aaaaaaaa-0000-4000-8000-000000000050";
const REVISION = "aaaaaaaa-0000-4000-8000-000000000060";
const LEASE = "aaaaaaaa-0000-4000-8000-000000000070";

function poste(index: number, label: string, expectedUnit = "u", qualifiers: Poste["qualifiers"] = {}): Poste {
  return { id: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`, label, expectedUnit, measurementBasis: null, qualifiers,
    sections: [{ id: "s", title: "Plomberie", order: 1 }], synonyms: [], referenceQuantity: 9876.5,
    origin: { kind: "manual", intentId: `i-${index}`, addedBy: "u-1", addedAt: "2026-11-22T08:00:00.000Z", addedInRevision: 1 } };
}
const LAVABO = poste(1, "Lavabo");
const VANNE = poste(2, "Vanne d’arrêt DN32");
const BAIGNOIRE = poste(3, "Baignoire");
const EF = poste(4, "Distribution EF", "ml", { network: "EF", material: "cuivre", diameter: "DN 22" });
const ITEMS = [LAVABO, VANNE, BAIGNOIRE, EF];

const ORDER = { kind: "item_list", version: 2, list: { revision_id: REVISION, revision: 3, content_sha256: "e".repeat(64), item_count: 4 } };

/** Rows as PostgREST serves them, one row (or none) for a single read. */
function served(rows: Array<Record<string, unknown>>, query: FakeQuery) {
  const result = servedRows(rows, query);
  return query.cardinality === "many" ? result : { ...result, data: (result.data as unknown[])[0] ?? null };
}

/** The request's row and the sealed revision as the worker's client reads them. */
function database(input: { order?: unknown; recorded?: string | null; entries?: Array<Record<string, unknown>>; itemCount?: number } = {}) {
  const entries = input.entries ?? itemListEntries({ items: ITEMS }).map((entry, position) => ({ ...entry, position, revision_id: REVISION,
    tenant_id: TENANT, project_id: PROJECT }));
  return createSupabaseFake({ tables: {
    takeoff_launch_requests: (query: FakeQuery) => served([{ id: REQUEST, tenant_id: TENANT, project_id: PROJECT,
      manifest: { format_version: 2, order: input.order ?? ORDER },
      item_list_revision_id: input.recorded === undefined ? REVISION : input.recorded }], query),
    takeoff_list_revisions: (query: FakeQuery) => served([{ id: REVISION, tenant_id: TENANT, project_id: PROJECT, revision: 3,
      item_count: input.itemCount ?? 4 }], query),
    takeoff_list_revision_entries: (query: FakeQuery) => servedRows([...entries,
      // Another revision's entry: never read for this one.
      { ...entries[0], revision_id: "aaaaaaaa-0000-4000-8000-0000000000ff", item_id: "cccccccc-0000-4000-8000-000000000001" }], query),
  } });
}

const unit = (key: string) => ({ launch_unit: { request_id: REQUEST, key, ordinal: 1, vector_pages: 4,
  budget: { tokens: 400_000, cost_cents: 2_500 } } });
function job(overrides: Partial<TakeoffJobProcessingRow> = {}): TakeoffJobProcessingRow {
  return { id: JOB, tenant_id: TENANT, project_id: PROJECT, estimate_version_id: null, level: "C", status: "processing",
    source_file_name: "Plan RDC.pdf", source_file_path: null, source_file_type: "application/pdf", plan_set_id: "plan-set",
    prompt_version: "takeoff-c-v1", schema_version: "v1", retry_count: 0, created_by: "aaaaaaaa-0000-4000-8000-000000000001",
    processing_lease_token: LEASE, processing_lease_expires_at: "2026-11-22T10:00:00Z", launch_request_id: REQUEST,
    execution_provider: "chatgpt_local", preparation_snapshot: unit(`plan:${PLAN}`), ...overrides };
}

async function pdf(pages: number) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([595, 842]);
  const bytes = await document.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The unit's PDF: its 4 retained pages, the plan's original pages 3 to 6, with a DPGF and a CCTP confirmed as references. */
async function sourceFile() {
  return { fileName: "Plan RDC.pdf", mimeType: "application/pdf", bytes: await pdf(4),
    sourceDocument: { kind: "plan_file" as const, plan_file_id: PLAN }, sourcePageNumbersByPage: [3, 4, 5, 6],
    contextFiles: [{ data: Buffer.from("Lavabo;9876,5;u").toString("base64"), mimeType: "text/csv" },
      { data: Buffer.from("%PDF-1.4 cctp").toString("base64"), mimeType: "application/pdf" }],
    contextReferences: [{ kind: "dpgf" as const, name: "DPGF.xlsx", revision: "A" }, { kind: "cctp" as const, name: "CCTP.pdf", revision: "B" }] };
}

/** The vector reading of the plan's page 5: an EF copper DN 22 length. */
function vectorOutcomes(quantity = 12.52): VectorPageOutcome[] {
  return [{ document: { kind: "plan_file", plan_file_id: PLAN }, fileName: "Plan RDC.pdf", page: 5, error: null,
    record: { location: null, scale: { status: "verified" }, mode: "vector", to_review: 0, labels: { incomplete: 0 } } as never,
    items: [{ item: { designation: "EF cuivre DN 22", quantity, unit: "ml", confidence: 0.9, evidence: "Lecture vectorielle : 3 tronçons.",
      category: "réseau (lecture vectorielle)" },
      geometry: { schema_version: 1, kind: "network", network: "EF", material: "cuivre", dn: 22, zone: null, level: null, groups: [],
        segments_m: [], polygon_m: null, length_m: quantity, area_m2: null, transform: null } as never }] }];
}

/** A reading of the plan: 3 lavabos on page 4, the valve uncertain (candidate page 6), no bathtub, 12.5 m of EF on page 5. */
const script = controlledPosteCall((entry) => {
  if (entry.label === "Lavabo") return posteMeasured(entry, [{ page: 2, quantity: 3 }]);
  if (entry.label === "Distribution EF") return posteMeasured(entry, [{ page: 3, quantity: 12.5, unit: "ml" }]);
  if (entry.label.startsWith("Vanne")) return { post_id: entry.key, outcome: "uncertain", searched_pages: entry.owned,
    reason_code: "QUALIFIER_UNREADABLE", reason_text: "Le diamètre n’est pas lisible.", observations: [{ page: 4, evidence: "vanne sans cote",
      method: "symbol_count", confidence: 0.4, quantity: 1, unit: "u", measurement_basis: null }] };
  return posteNotFound(entry);
}, { alter: (output) => ({ ...output, unlisted_findings: [{ page: 1, designation: "Siphon de sol", evidence: "symbole SdS" }] }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(publishTakeoffItemAnswers).mockResolvedValue("dddddddd-0000-4000-8000-000000000001");
});

describe("readTakeoffItemListOrder", () => {
  it("reads nothing for a job without a request", async () => {
    const fake = createSupabaseFake({});
    await expect(readTakeoffItemListOrder(fake.client as never, job({ launch_request_id: null }))).resolves.toBeNull();
    expect(fake.tablesTouched).toEqual([]);
  });

  it("gives the list a job's request sealed, and nothing for the free extraction", async () => {
    await expect(readTakeoffItemListOrder(database().client as never, job())).resolves.toEqual({ requestId: REQUEST, revisionId: REVISION,
      revision: 3, itemCount: 4, contentSha256: "e".repeat(64) });
    await expect(readTakeoffItemListOrder(database({ order: { kind: "free_extraction", version: 1, list: null }, recorded: null }).client as never,
      job())).resolves.toBeNull();
  });

  it("tries a failed read of the request again, and reads nothing else", async () => {
    const fake = createSupabaseFake({ tables: { takeoff_launch_requests: () => ({ data: null, error: { code: "57014", message: "timeout" } }) } });
    await expect(readTakeoffItemListOrder(fake.client as never, job())).rejects.toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR,
      retryable: true });
  });

  it("refuses a request whose recorded list is not the one its manifest sealed", async () => {
    await expect(readTakeoffItemListOrder(database({ recorded: "aaaaaaaa-0000-4000-8000-0000000000aa" }).client as never, job()))
      .rejects.toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
    await expect(readTakeoffItemListOrder(database().client as never, job({ tenant_id: "aaaaaaaa-0000-4000-8000-0000000000bb" })))
      .rejects.toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR });
  });
});

describe("readSealedItemListItems", () => {
  const scope = { tenantId: TENANT, projectId: PROJECT, revisionId: REVISION, itemCount: 4 };

  it("reads the sealed revision's items in its order, and no other revision's", async () => {
    const items = await readSealedItemListItems(database().client as never, scope);
    expect(items.map((item) => item.id)).toEqual(ITEMS.map((item) => item.id));
    expect(items[3]).toMatchObject({ label: "Distribution EF", expectedUnit: "ml", qualifiers: { network: "EF", material: "cuivre" } });
  });

  it("refuses a revision whose count or positions are not the sealed ones", async () => {
    await expect(readSealedItemListItems(database({ itemCount: 5 }).client as never, { ...scope, itemCount: 5 })).rejects.toThrow();
    await expect(readSealedItemListItems(database().client as never, { ...scope, itemCount: 5 })).rejects.toThrow();
    const gap = itemListEntries({ items: ITEMS }).map((entry, position) => ({ ...entry, position: position === 3 ? 7 : position,
      revision_id: REVISION, tenant_id: TENANT, project_id: PROJECT }));
    await expect(readSealedItemListItems(database({ entries: gap }).client as never, scope)).rejects.toThrow();
  });
});

describe("buildTakeoffItemAnswersPublication", () => {
  async function publication(vectors = vectorOutcomes()) {
    const file = await sourceFile();
    const reading = await readPlanAgainstItemList({ call: script, job: job(), items: ITEMS, listRevision: 3, model: "controlled",
      config: { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 },
      pdf: { fileName: file.fileName, bytes: file.bytes, originalPageNumbers: file.sourcePageNumbersByPage } });
    const plan = finishPlanReading(reading, ITEMS, posteVectorReadings(vectors, PLAN), JOB);
    return buildTakeoffItemAnswersPublication({ job: job(), items: ITEMS, list: { revisionId: REVISION, revision: 3, itemCount: 4 }, reading,
      plan, planFile: { kind: "plan_file", plan_file_id: PLAN }, fileName: file.fileName, mimeType: file.mimeType, vectorOutcomes: vectors,
      runMetrics: [], model: "controlled", completedAt: new Date("2026-11-22T09:00:00.000Z"), totalDurationMs: 1_000 });
  }

  it("gives the command the job, its lease, the exchange's versions and the unit's original pages", async () => {
    expect(await publication()).toMatchObject({ p_job_id: JOB, p_lease_token: LEASE, p_completed_at: "2026-11-22T09:00:00.000Z",
      p_model: "controlled", p_prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
      p_exchange: { schema_version: "v2", prompt_version: POSTE_EXCHANGE_PROMPT_VERSION }, p_unit_pages: [3, 4, 5, 6] });
  });

  it("gives exactly one answer per item, in the list's order, each in the addendum's shape", async () => {
    const { p_answers: answers } = await publication();
    expect(answers.map((answer) => [answer.item_id, answer.outcome])).toEqual([[LAVABO.id, "measured"], [VANNE.id, "uncertain"],
      [BAIGNOIRE.id, "not_found"], [EF.id, "measured"]]);
    for (const answer of answers) {
      expect(Object.keys(answer).sort()).toEqual(["candidate", "item_id", "observations", "outcome", "quantity", "reasons", "searched_pages",
        "unreadable_pages"]);
      expect([...answer.searched_pages, ...answer.unreadable_pages].sort()).toEqual([3, 4, 5, 6]);
    }
    expect(answers[0]).toMatchObject({ quantity: { value: 3, unit: "u" }, candidate: null, reasons: [] });
    expect(answers[1]).toMatchObject({ quantity: null, candidate: { value: 1, unit: "u" },
      reasons: [{ code: "QUALIFIER_UNREADABLE", by: "model", text: "Le diamètre n’est pas lisible.", chunk_id: "f1-b1" }] });
    expect(answers[2]).toMatchObject({ quantity: null, candidate: null, observations: [],
      reasons: [{ code: "NO_INDICATION", by: "model", chunk_id: "f1-b1" }] });
  });

  it("makes a positive row of each contribution only, linked to it; candidates and alternatives make none", async () => {
    const built = await publication();
    const observations = built.p_answers.flatMap((answer) => answer.observations.map((entry) => ({ ...entry, item: answer.item_id })));
    const contributions = observations.filter((entry) => entry.role === "contribution");
    expect(contributions.map((entry) => [entry.item, entry.page, entry.quantity])).toEqual([[LAVABO.id, 4, 3], [EF.id, 5, 12.5]]);
    expect(built.p_items.map((row) => row.id)).toEqual(contributions.map((entry) => entry.takeoff_item_id));
    expect(built.p_items[0]).toMatchObject({ designation: "Lavabo", quantity: 3, unit: "u", source_page: 4, source_file_name: "Plan RDC.pdf",
      is_excluded: false, exclusion_reason: null, metadata: { source_document: { kind: "plan_file", plan_file_id: PLAN },
        poste: { item_id: LAVABO.id, list_revision_id: REVISION, exchange: "v2", chunk_id: "f1-b1", method: "symbol_count" } } });
    expect(observations.filter((entry) => entry.role !== "contribution").every((entry) => entry.takeoff_item_id === null)).toBe(true);
    // No row carries a reference quantity of the DPGF.
    expect(JSON.stringify(built)).not.toContain("9876");
  });

  it("names the vector row it inserts in each vector observation, every vector row excluded and none selected", async () => {
    const built = await publication();
    const vector = built.p_answers[3].observations.find((entry) => entry.source === "vector")!;
    expect(vector).toMatchObject({ role: "alternative", quantity: 12.52, takeoff_item_id: null });
    expect(built.p_vector?.items.map((row) => row.id)).toEqual([vector.vector_key]);
    expect(built.p_vector?.items[0]).toMatchObject({ is_excluded: true });
    expect(built.p_vector?.choices).toEqual([]);
    expect((await publication([])).p_vector).toBeUndefined();
  });

  it("keeps a finding outside the list with the result, never as an answer", async () => {
    const built = await publication();
    expect(built.p_findings).toEqual([{ page: 3, designation: "Siphon de sol", evidence: "symbole SdS", chunk_id: "f1-b1" }]);
    expect(built.p_result.warnings).toContainEqual({ code: "POSTE_HORS_LISTE", severity: "info",
      message: "Page 3 : Siphon de sol — symbole SdS" });
    expect(built.p_result).toMatchObject({ tables: [], confidence: null, token_count: 1_000, cost_cents: 0,
      extracted_json: { format: "item_list", schema_version: "v2", prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
        list: { revision_id: REVISION, revision: 3, item_count: 4 }, plan_pages: [3, 4, 5, 6] } });
  });
});

describe("processItemListLevelC", () => {
  async function run(overrides: Partial<Parameters<typeof processItemListLevelC>[0]> = {}) {
    return processItemListLevelC({ supabase: database().client as never, job: job(), sourceFile: await sourceFile(), call: script,
      model: "controlled", order: { requestId: REQUEST, revisionId: REVISION, revision: 3, itemCount: 4, contentSha256: "e".repeat(64) },
      userId: "aaaaaaaa-0000-4000-8000-000000000001", processingStartedAt: new Date("2026-11-22T08:59:00.000Z"),
      now: () => new Date("2026-11-22T09:00:00.000Z"), renewLease: vi.fn(async () => {}), readVectors: async () => vectorOutcomes(),
      ...overrides });
  }

  it("reads its plan against the sealed list and publishes the answers with its end, under its lease", async () => {
    const renewLease = vi.fn(async () => {});
    const result = await run({ renewLease });
    expect(publishTakeoffItemAnswers).toHaveBeenCalledTimes(1);
    const [, published] = vi.mocked(publishTakeoffItemAnswers).mock.calls[0];
    expect(published.p_answers.map((answer) => answer.item_id)).toEqual(ITEMS.map((item) => item.id));
    expect(published.p_unit_pages).toEqual([3, 4, 5, 6]);
    expect(renewLease.mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(publishTakeoffItemAnswers).mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ jobId: JOB, resultId: "dddddddd-0000-4000-8000-000000000001", status: "completed", itemsCount: 2,
      pageCount: 4, chunksCount: 1 });
    expect(logCompletedAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ resultId: "dddddddd-0000-4000-8000-000000000001" }));
    expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, projectId: PROJECT, jobId: JOB }));
  });

  it("attaches the CCTP only, never the DPGF", async () => {
    const call = controlledPosteCall();
    await run({ call });
    // The CCTP, then the plan's fragment; the DPGF's rows (with their quantities) never reach the model.
    expect(call.received[0].files).toHaveLength(2);
    expect(Buffer.from(call.received[0].files[0].data, "base64").toString()).toBe("%PDF-1.4 cctp");
    expect(call.received[0].files.map((file) => Buffer.from(file.data, "base64").toString())).not.toContain("Lavabo;9876,5;u");
    expect(call.received[0].prompt).not.toContain("DPGF.xlsx");
  });

  it("refuses a grouped analysis of the second order before any call: the list is read plan by plan", async () => {
    const call = controlledPosteCall();
    await expect(run({ call, job: job({ preparation_snapshot: unit("grouped") }) }))
      .rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED, retryable: false });
    expect(call.received).toEqual([]);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  // The second barrier: a job of the second order whose PDF holds pages of several plans is stopped before any call.
  it("stops a second-order job reading several plans before any call, spending nothing", async () => {
    const call = controlledPosteCall();
    const file = await sourceFile();
    await expect(run({ call, sourceFile: { ...file, sourceDocument: undefined, sourceDocumentsByPage: [
      { kind: "plan_file", plan_file_id: PLAN }, { kind: "plan_file", plan_file_id: PLAN }, { kind: "plan_file", plan_file_id: "other-plan" },
      { kind: "plan_file", plan_file_id: "other-plan" }] } })).rejects.toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
    expect(call.received).toEqual([]);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  it("publishes nothing when an answer is refused, nor when the lease is lost before the publication", async () => {
    const omitting = controlledPosteCall((entry) => entry.label === "Baignoire" ? "omit" : posteNotFound(entry));
    await expect(run({ call: omitting })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
      details: expect.objectContaining({ reason: "MISSING_ANSWER" }) });
    const lost = vi.fn(async () => {
      throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Le lease takeoff n'est plus disponible.", retryable: false });
    });
    await expect(run({ renewLease: lost })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  it("reads a plan's sealed list again on each attempt, never another revision", async () => {
    const fake = database();
    await run({ supabase: fake.client as never });
    expect(fake.queries.filter((query) => query.table === "takeoff_list_revision_entries")
      .every((query) => query.filters.some((filter) => filter.column === "revision_id" && filter.value === REVISION))).toBe(true);
  });
});
