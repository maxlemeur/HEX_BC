import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/level-c-reading", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/level-c-reading")>(),
  // The first format's checks before a paid call (tested with it): here the page count, the detailed configuration within
  // what the request has left, and what the request has left.
  prepareLevelCReading: vi.fn(async (input: { sourceFile: { bytes: ArrayBuffer } }) => ({
    pageCount: (await PDFDocument.load(input.sourceFile.bytes)).getPageCount(),
    config: { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2, maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000,
      maxCostCents: 2_500 }, requestBudget: { remainingTokens: 400_000, remainingCostCents: 2_500 } })),
}));
vi.mock("@/lib/takeoff/processing-audit", () => ({ logCompletedAuditEvent: vi.fn() }));
// What the checks before a paid call read when a case runs them for real (a job paid by a personal key): the tenant's
// default budget, the key's sealed mandate, and no write of a page count.
const keyMandate = vi.hoisted(() => ({ maxTokens: null as number | null }));
vi.mock("@/lib/takeoff/feature-flags", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/feature-flags")>(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn(async () => ({ thresholdPages: 15, chunkSizePages: 10, overlapPages: 2, maxPdfPages: 200,
    timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 })),
}));
vi.mock("@/lib/takeoff/payment-mandate-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/payment-mandate-server")>(),
  readTakeoffApiMandate: vi.fn(async () => ({ model: "gpt-6.1-terra", reasoningEffort: "medium", connectionVersion: 1,
    connectionId: "aaaaaaaa-0000-4000-8000-000000000090", hostId: "urn:uuid:aaaaaaaa-0000-8000-8000-000000000099",
    maxTokens: keyMandate.maxTokens, maxNanoUsd: 25_000_000_000 })),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/takeoff/plan-file-page-counts", () => ({ persistDetectedPlanFilePageCounts: vi.fn() }));
// The vector classifier's calls as its own bound counts them (its conditions are environment flags): none unless a case says.
vi.mock("@/lib/takeoff/vectors/worker-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/vectors/worker-server")>(), takeoffVectorGroupCallsBound: vi.fn(() => 0),
}));
vi.mock("@/lib/takeoff/rules/recompute-server", () => ({ isTakeoffRulesEnabled: () => true, recomputeTakeoffRulesQuietly: vi.fn() }));
vi.mock("@/lib/takeoff/poste-publication-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/poste-publication-server")>(), publishTakeoffItemAnswers: vi.fn(),
}));

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { readSealedItemListItems } from "@/lib/takeoff/item-list-server";
import { itemListEntries } from "@/lib/takeoff/item-list";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import { TAKEOFF_ITEM_ANSWER_LIMITS } from "@/lib/takeoff/item-answer-limits";
import { createSupabaseFake, servedRows, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { planPosteBatches, POSTE_EXCHANGE_PROMPT_VERSION } from "@/lib/takeoff/poste-exchange";
import type { TakeoffPlanLaunchManifest } from "@/lib/takeoff/launch-request";
import type { Poste } from "@/lib/takeoff/poste-list";
import { logCompletedAuditEvent } from "@/lib/takeoff/processing-audit";
import { buildTakeoffItemAnswersPublication, publishTakeoffItemAnswers } from "@/lib/takeoff/poste-publication-server";
import { finishPlanReading, posteVectorReadings, readPlanAgainstItemList } from "@/lib/takeoff/poste-reading";
import { processItemListLevelC, readTakeoffItemListOrder } from "@/lib/takeoff/poste-reading-job-server";
import { controlledPosteCall, orderSensitivePosteList, posteMeasured, posteNotFound, readPosteManifest } from "@/lib/takeoff/poste-reading.test-fixtures";
import { boundPosteReadingRequest } from "@/lib/takeoff/poste-reading-bounds";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import { recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import { takeoffVectorGroupCallsBound, type VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";
import { prepareLevelCReading } from "@/lib/takeoff/level-c-reading";

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

type ManifestPlan = { id: string; pages?: number[]; pageCount: number; vectorPages?: number; budget?: { tokens: number; cost_cents: number } };
/** The request's sealed manifest of one analysis per plan, its plans in their recorded order, each unit with its share. */
function planManifest(plans: ManifestPlan[], budget = { tokens: 400_000, cost_cents: 2_500 },
  order: unknown = ORDER): TakeoffPlanLaunchManifest {
  return { format_version: 2, intent: "initial", order: order as TakeoffPlanLaunchManifest["order"],
    plans: plans.map((plan, index) => ({ entry_key: plan.id, name: `Plan ${index + 1}.pdf`, logical_id: plan.id, intake_document_id: null,
      plan_file_id: plan.id, generation: null, content_sha256: "a".repeat(64), pages: plan.pages ?? [], page_count: plan.pageCount })),
    units: plans.map((plan, index) => ({ key: `plan:${plan.id}`, ordinal: index + 1, plans: [plan.id] as [string], pages: plan.pages ?? [],
      page_count: plan.pageCount, budget: plan.budget ?? budget, vector_pages: plan.vectorPages ?? 0 })),
    references: [], coverage: { plans_retained: plans.length, plans_omitted: [], references_omitted: [] },
    preparation: { revision: 1, rule_version: 1 }, budget, dispatch: { order: "display_name", version: 1 } };
}
/** The job's own plan: its 4 retained pages of 6, its share the whole envelope, 4 vector pages. */
const MANIFEST = planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, vectorPages: 4 }]);
const SEALED = { requestId: REQUEST, revisionId: REVISION, revision: 3, itemCount: 4, contentSha256: "e".repeat(64), manifest: MANIFEST,
  askedItemIds: null };

/** Rows as PostgREST serves them, one row (or none) for a single read. */
function served(rows: Array<Record<string, unknown>>, query: FakeQuery) {
  const result = servedRows(rows, query);
  return query.cardinality === "many" ? result : { ...result, data: (result.data as unknown[])[0] ?? null };
}

/** The request's row and the sealed revision as the worker's client reads them. */
function database(input: { order?: unknown; recorded?: string | null; entries?: Array<Record<string, unknown>>; itemCount?: number;
  items?: Poste[]; manifest?: unknown } = {}) {
  const entries = input.entries ?? itemListEntries({ items: input.items ?? ITEMS }).map((entry, position) => ({ ...entry, position,
    revision_id: REVISION, tenant_id: TENANT, project_id: PROJECT }));
  return createSupabaseFake({ tables: {
    takeoff_launch_requests: (query: FakeQuery) => served([{ id: REQUEST, tenant_id: TENANT, project_id: PROJECT,
      manifest: input.manifest ?? planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, vectorPages: 4 }], undefined,
        input.order ?? ORDER),
      item_list_revision_id: input.recorded === undefined ? REVISION : input.recorded }], query),
    takeoff_list_revisions: (query: FakeQuery) => served([{ id: REVISION, tenant_id: TENANT, project_id: PROJECT, revision: 3,
      item_count: input.itemCount ?? input.items?.length ?? 4 }], query),
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

/** A vector page of rooms: each a surface, its room's label printed in it. */
function surfaceOutcome(page: number, rooms: Array<{ room: string; quantity: number; confidence?: number }>): VectorPageOutcome {
  return { document: { kind: "plan_file", plan_file_id: PLAN }, fileName: "Plan RDC.pdf", page, error: null,
    record: { location: null, scale: { status: "verified" }, mode: "vector", to_review: 0, labels: { incomplete: 0 } } as never,
    items: rooms.map(({ room, quantity, confidence = 0.8 }) => ({
      item: { designation: `Surface « ${room} »`, quantity, unit: "m2", confidence, evidence: `Surface du local « ${room} » lue sur le plan.`,
        category: "surface (lecture vectorielle)" },
      geometry: { schema_version: 1, kind: "surface", network: null, material: null, dn: null, zone: null, level: null, groups: [],
        segments_m: [], polygon_m: null, length_m: null, area_m2: quantity, transform: null } as never,
      room: { label: room, printed_m2: quantity } })) };
}

/**
 * What the command and the first order's end accept of a vector reading (the checks a vector row, a vector page and a
 * geometry meet, listed with the closing round's report): nothing the worker sends would make them refuse the call.
 */
function storableVector(vector: NonNullable<Awaited<ReturnType<typeof buildTakeoffItemAnswersPublication>>["p_vector"]>,
  rows: ReadonlySet<string>) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return vector.choices.length === 0
    && vector.pages.every((page) => uuid.test(page.id) && Number.isInteger(page.source_page) && page.source_page >= 1
      && page.schema_version === 1 && jsonbTextBytes(page.reading) <= 262_144 && jsonbTextBytes(page.rule_anchors) <= 262_144
      && (page.source_file_name === null || page.source_file_name.length <= 255) && Number.isFinite(jsonbTextBytes(page)))
    && vector.items.every((item) => uuid.test(item.id) && item.is_excluded === true && item.source_page !== null
      && Number.isInteger(item.source_page) && item.source_page >= 1 && item.source_page <= 100_000 && !rows.has(item.id)
      && Math.round(item.quantity * 1_000) > 0 && Math.round(item.quantity * 1_000) <= 999_999_999_999
      && item.confidence !== null && item.confidence >= 0 && item.confidence <= 1 && Number.isFinite(jsonbTextBytes(item)))
    && vector.geometries.every((geometry) => geometry.schema_version === 1 && jsonbTextBytes(geometry.geometry) <= 524_288
      && vector.items.some((item) => item.id === geometry.takeoff_item_id)
      && vector.pages.some((page) => page.id === geometry.vector_page_id));
}

/** A reading of the plan: 3 lavabos on page 4, the valve uncertain (candidate page 6), no bathtub, 12.5 m of EF on page 5. */
const script = controlledPosteCall((entry) => {
  if (entry.label === "Lavabo") return posteMeasured(entry, [{ page: 2, quantity: 3 }]);
  if (entry.label === "Distribution EF") return posteMeasured(entry, [{ page: 3, quantity: 12.5, unit: "ml" }]);
  if (entry.label.startsWith("Vanne")) return { post_id: entry.key, outcome: "uncertain", searched_pages: entry.owned,
    reason_code: "QUALIFIER_UNREADABLE", reason_text: "Le diamètre n’est pas lisible.", observations: [{ page: 4, evidence: "vanne sans cote",
      method: "symbol_count", confidence: 0.4, quantity: 1, unit: "u", measurement_basis: null, counts_as: "distinct",
      basis_as_requested: false }] };
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
    await expect(readTakeoffItemListOrder(database().client as never, job())).resolves.toEqual(SEALED);
    await expect(readTakeoffItemListOrder(database({ order: { kind: "free_extraction", version: 1, list: null }, recorded: null }).client as never,
      job())).resolves.toBeNull();
  });

  it("gives the items a new measure of a selection asks, and refuses a list that names them in another shape", async () => {
    const asked = { ...ORDER, list: { ...ORDER.list, asked_item_ids: [VANNE.id.toUpperCase(), LAVABO.id] } };
    await expect(readTakeoffItemListOrder(database({ order: asked }).client as never, job())).resolves.toMatchObject({
      askedItemIds: [VANNE.id, LAVABO.id], itemCount: 4 });
    for (const shape of [[], "x", [1]]) {
      await expect(readTakeoffItemListOrder(database({ order: { ...ORDER, list: { ...ORDER.list, asked_item_ids: shape } } }).client as never,
        job())).rejects.toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
    }
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
  async function publication(vectors = vectorOutcomes(), options: { call?: typeof script; items?: Poste[];
    snapshot?: TakeoffJobProcessingRow["preparation_snapshot"]; chunked?: boolean;
    plan?: (plan: ReturnType<typeof finishPlanReading>) => ReturnType<typeof finishPlanReading> } = {}) {
    const file = await sourceFile();
    const items = options.items ?? ITEMS;
    const reading = await readPlanAgainstItemList({ call: options.call ?? script, job: job(), items, listRevision: 3, model: "controlled",
      config: { ...(options.chunked ? { thresholdPages: 2, chunkSizePages: 2, overlapPages: 0 }
        : { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2 }), timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 },
      pdf: { fileName: file.fileName, bytes: file.bytes, originalPageNumbers: file.sourcePageNumbersByPage } });
    const read = finishPlanReading(reading, items, posteVectorReadings(vectors, PLAN), JOB);
    const plan = options.plan ? options.plan(read) : read;
    const owned = options.snapshot === undefined ? job() : job({ preparation_snapshot: options.snapshot });
    return buildTakeoffItemAnswersPublication({ job: owned, items, list: { revisionId: REVISION, revision: 3, itemCount: items.length }, reading,
      plan, planFile: { kind: "plan_file", plan_file_id: PLAN }, fileName: file.fileName, mimeType: file.mimeType, vectorOutcomes: vectors,
      runMetrics: [], model: "controlled", completedAt: new Date("2026-11-22T09:00:00.000Z"), totalDurationMs: 1_000 });
  }

  // PR 3c closing round, point 1: 1,000 distinct items a room « Bureau » matches, 32 rooms on the page and short answers of
  // the model: every reading attached to every item would publish 12.8 MB of answers, past the command's 8 MiB. The
  // readings are attached while the answers stay within it; those left out stay the result's own and each answer says so.
  it("attaches vector readings only while the answers stay within what the command stores", async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => poste(100 + index, `Bureau ${index + 1}`, "m2"));
    const rooms = Array.from({ length: 32 }, (_, index) => ({ room: "Bureau", quantity: 10 + index }));
    const built = await publication([surfaceOutcome(5, rooms)], { call: controlledPosteCall(posteNotFound), items });
    expect(jsonbTextBytes(built.p_answers)).toBeLessThanOrEqual(TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes);
    const vectorObservations = built.p_answers.flatMap((answer) => answer.observations.filter((entry) => entry.source === "vector"));
    expect(vectorObservations.length).toBeGreaterThan(0);
    expect(vectorObservations.length).toBeLessThan(32 * 1_000);
    const partial = built.p_answers.filter((answer) => answer.observations.length < 32);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.every((answer) => answer.reasons.some((reason) => reason.code === "VECTOR_READINGS_UNATTACHED"))).toBe(true);
    const rows = new Set(built.p_vector!.items.map((item) => item.id));
    expect(vectorObservations.every((entry) => rows.has(entry.vector_key!))).toBe(true);
  });

  // PR 3c closing round, point 1: the largest publication an admitted unit can produce, every answer at the schema's maxima
  // (each call's 160 observations, every text at its bound in three-byte characters, every page searched and unreadable),
  // fits what the command stores, and stays within the bound its admission computed.
  it("keeps the largest publication an admitted unit can produce within what the command stores", async () => {
    const itemsOf = (count: number) => Array.from({ length: count }, (_, index) => poste(1_000 + index, `Bureau ${index + 1}`, "m2"));
    const bound = (count: number) => boundPosteReadingRequest({ batches: planPosteBatches(itemsOf(count)).map((batch) => batch.length),
      units: [{ key: `plan:${PLAN}`, pieces: [{ id: PLAN, name: "Plan RDC.pdf" }], pages: 4, maxPage: 6, budgetTokens: 1_000_000_000 }],
      requestBudgetTokens: 1_000_000_000, chunking: { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2 },
      estimateTokensPerCall: TAKEOFF_PAID_CALL_ESTIMATE_TOKENS });
    let admitted = 1;
    for (let low = 1, high = 1_600; low <= high;) {
      const middle = Math.floor((low + high) / 2);
      if (bound(middle).ok) { admitted = middle; low = middle + 1; } else high = middle - 1;
    }
    expect(bound(admitted + 1).units[0].exceeded).toContain("publication_bytes");
    const given = new Map<string, number>();
    const worst = controlledPosteCall((entry) => {
      const used = given.get(entry.chunkId) ?? 0;
      const count = Math.min(16, 160 - used);
      given.set(entry.chunkId, used + count);
      return { post_id: entry.key, outcome: "uncertain", searched_pages: entry.owned, reason_code: "CONTRADICTORY_EVIDENCE",
        reason_text: "€".repeat(160), observations: Array.from({ length: count }, () => ({ page: entry.pages.at(-1)!, evidence: "€".repeat(160),
          method: "scaled_measure" as const, confidence: 0.12345678901234567, quantity: 999_999_999.999, unit: "€".repeat(32),
          measurement_basis: "€".repeat(120), counts_as: "distinct" as const, basis_as_requested: false })) };
    }, { unreadable: (manifest) => manifest.page_scope.pages });
    const rooms = Array.from({ length: 32 }, (_, index) => ({ room: "Bureau", quantity: 10 + index }));
    const built = await publication([surfaceOutcome(5, rooms)], { call: worst, items: itemsOf(admitted) });
    expect(jsonbTextBytes(built.p_answers)).toBeLessThanOrEqual(TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes);
    const modelOnly = built.p_answers.map((answer) => ({ ...answer, observations: answer.observations.filter((entry) => entry.source === "model") }));
    expect(jsonbTextBytes(modelOnly)).toBeLessThanOrEqual(bound(admitted).units[0].publicationBytes);
    expect(built.p_answers.every((answer) => answer.reasons.length <= TAKEOFF_ITEM_ANSWER_LIMITS.reasons
      && answer.observations.length <= TAKEOFF_ITEM_ANSWER_LIMITS.observations)).toBe(true);
  }, 60_000);

  // #461: the command keeps at most 2000 findings outside the list; the result says how many more the reading saw. A state
  // an admitted reading never reaches (its plan's 40 calls give at most 800 findings, poste-reading-bounds.test.ts): the
  // cap is a guard, tested here on an injected reading.
  it("keeps at most 2000 findings outside the list, and says how many more were seen", async () => {
    const built = await publication(vectorOutcomes(), { plan: (plan) => ({ ...plan, unlistedFindings: Array.from({ length: 2_003 }, (_, index) => ({
      page: 3, designation: `Ouvrage fictif ${index + 1}`, evidence: "symbole sans poste", chunkId: "f1-b1" })) }) });
    expect(built.p_findings).toHaveLength(2_000);
    expect(built.p_findings.at(-1)).toMatchObject({ designation: "Ouvrage fictif 2000" });
    expect(built.p_result.warnings.filter((warning) => warning.code === "POSTE_HORS_LISTE")).toHaveLength(2_000);
    expect(built.p_result.warnings).toContainEqual({ code: "POSTE_HORS_LISTE_TRONQUE", severity: "warning",
      message: "3 autres ouvrages vus hors de la liste ne sont pas repris (2\u202f000 au plus)." });
  });

  // #470: the publication refuses a contribution whose row the insert trigger excludes as an hypothesis (an estimate, or a
  // reading the rules class non-observable): such a reading is a candidate of an uncertain answer, with its reason.
  it("never sends an estimate as a contribution: the objective « estimate » makes a measure a candidate, with its reason", async () => {
    const snapshot = { ...unit(`plan:${PLAN}`), preparation: { objective: "estimate" } } as TakeoffJobProcessingRow["preparation_snapshot"];
    const built = await publication([], { snapshot });
    expect(built.p_items).toEqual([]);
    expect(built.p_answers[0]).toMatchObject({ item_id: LAVABO.id, outcome: "uncertain", quantity: null, candidate: { value: 3, unit: "u" },
      reasons: [{ code: "QUANTITY_ESTIMATED", by: "worker", text: null, chunk_id: null }] });
    expect(built.p_answers[0].observations).toEqual([expect.objectContaining({ role: "candidate", quantity: 3, takeoff_item_id: null })]);
    expect(built.p_answers[3]).toMatchObject({ item_id: EF.id, outcome: "uncertain", quantity: null, candidate: { value: 12.5, unit: "ml" } });
  });

  it("never sends a reading the rules class non-observable as a contribution: a support is a candidate, with its reason", async () => {
    const supports = poste(5, "Supports de canalisation", "u");
    const counting = controlledPosteCall((entry) => entry.label === "Lavabo" ? posteMeasured(entry, [{ page: 2, quantity: 3 }])
      : entry.label.startsWith("Supports") ? posteMeasured(entry, [{ page: 3, quantity: 6 }]) : posteNotFound(entry));
    const built = await publication([], { call: counting, items: [LAVABO, supports] });
    expect(built.p_items.map((row) => [row.designation, row.quantity])).toEqual([["Lavabo", 3]]);
    expect(built.p_answers[0]).toMatchObject({ outcome: "measured", quantity: { value: 3, unit: "u" } });
    expect(built.p_answers[1]).toMatchObject({ item_id: supports.id, outcome: "uncertain", quantity: null, candidate: { value: 6, unit: "u" },
      reasons: [{ code: "NOT_OBSERVABLE", by: "worker" }] });
    expect(built.p_answers[1].observations).toEqual([expect.objectContaining({ role: "candidate", quantity: 6, takeoff_item_id: null })]);
  });

  // PR 3c fix round, point 3: a long label is cut on whole characters, never inside a surrogate pair.
  it("cuts a long label on whole characters", async () => {
    const long = poste(6, `${"a".repeat(499)}🧱 et suite`, "u");
    const counting = controlledPosteCall((entry) => entry.label.startsWith("aaa") ? posteMeasured(entry, [{ page: 2, quantity: 2 }])
      : posteNotFound(entry));
    const built = await publication([], { call: counting, items: [long] });
    const [row] = built.p_items;
    expect(Array.from(row.designation)).toHaveLength(500);
    expect(row.designation.endsWith("🧱")).toBe(true);
    // No lone surrogate: the body the database parses is valid JSON text.
    expect(row.designation.isWellFormed()).toBe(true);
  });

  // #461: a contribution's row and its observation carry the same value, to the thousandth, read once.
  it("gives each contribution's row its observation's own value, at the stored precision", async () => {
    const precise = controlledPosteCall((entry) => entry.label === "Distribution EF"
      ? posteMeasured(entry, [{ page: 3, quantity: 1.2345, unit: "ml" }]) : posteNotFound(entry));
    const built = await publication([], { call: precise });
    const [contribution] = built.p_answers.flatMap((answer) => answer.observations.filter((entry) => entry.role === "contribution"));
    expect(built.p_items).toEqual([expect.objectContaining({ quantity: 1.235, unit: "ml" })]);
    expect(contribution).toMatchObject({ quantity: 1.235, takeoff_item_id: built.p_items[0].id });
    expect(built.p_answers[3].quantity).toEqual({ value: 1.235, unit: "ml" });
  });

  it("gives the command the job, its lease, the exchange's versions and the unit's original pages", async () => {
    expect(await publication()).toMatchObject({ p_job_id: JOB, p_lease_token: LEASE, p_completed_at: "2026-11-22T09:00:00.000Z",
      p_model: "controlled", p_prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
      p_exchange: { schema_version: "v3", prompt_version: POSTE_EXCHANGE_PROMPT_VERSION }, p_unit_pages: [3, 4, 5, 6] });
  });

  it.each(["quantity only", "unit only", "missing partial figure"])("publishes the other measures after an unusable indication (%s)", async (defect) => {
    const call = controlledPosteCall((entry) => {
      if (entry.label === LAVABO.label && entry.chunkId === "f1-b1") return posteMeasured(entry, [{ page: 1, quantity: 3 }]);
      if (entry.label !== VANNE.label || entry.chunkId !== "f2-b1") return posteNotFound(entry);
      const indication = { page: 2, quantity: defect === "quantity only" ? 2 : null, unit: defect === "unit only" ? "u" : null,
        method: "annotation" as const, evidence: "Repère sur le plan", measurement_basis: null, basis_as_requested: false,
        counts_as: "distinct" as const, confidence: 0.5 };
      return { ...posteNotFound(entry), outcome: "uncertain", reason_code: "PARTIAL_QUANTITY", reason_text: "Repère sur le plan",
        observations: defect === "missing partial figure" ? [] : [indication] };
    });
    const built = await publication([], { call, chunked: true, items: [LAVABO, VANNE] });
    const [measure, obstacle] = built.p_answers;
    expect(built.p_items).toEqual([expect.objectContaining({ designation: "Lavabo", quantity: 3, unit: "u", source_page: 3 })]);
    expect(measure).toMatchObject({ outcome: "measured", quantity: { value: 3, unit: "u" } });
    expect(obstacle).toMatchObject({ outcome: "uncertain", candidate: null, searched_pages: [3, 4, 5, 6], reasons: expect.arrayContaining([
      expect.objectContaining({ code: "FIGURE_UNUSABLE", by: "worker", chunk_id: "f2-b1" }),
    ]), observations: defect === "missing partial figure" ? [] : [expect.objectContaining({ page: 6, quantity: null, unit: null })] });
    expect(call.received.map(({ chunkId }) => chunkId)).toEqual(["f1-b1", "f2-b1"]);
  });

  it("publishes partial coverage when another basis is excluded inside the same fragment", async () => {
    const call = controlledPosteCall((entry) => ({ ...posteNotFound(entry), outcome: "uncertain", reason_code: "UNIT_OR_BASIS_UNCLEAR",
      reason_text: "Le second tronçon est mesuré au nu.", observations: ["axe", "nu"].map((basis, index) => ({ page: index + 1,
        quantity: index === 0 ? 3 : 8, unit: "ml", method: "scaled_measure", evidence: `Tronçon ${basis}`, measurement_basis: basis,
        basis_as_requested: index === 0, counts_as: "distinct", confidence: 0.5 })) }));
    const built = await publication([], { call, items: [{ ...EF, measurementBasis: "axe" }] });
    expect(built.p_answers[0]).toMatchObject({ outcome: "uncertain", quantity: null, candidate: { value: 3, unit: "ml" },
      reasons: expect.arrayContaining([expect.objectContaining({ code: "CANDIDATE_PARTIAL", by: "worker" })]) });
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

  it("publishes a rejected candidate's obstacle and location without making a quantity or a contribution", async () => {
    const call = controlledPosteCall((entry) => entry.label === VANNE.label ? {
      ...posteNotFound(entry), outcome: "uncertain", reason_code: "SCALE_UNKNOWN", reason_text: "Vérifier la cote du tronçon.",
      observations: [{ page: 2, quantity: 8, unit: "ml", method: "scaled_measure", evidence: "Tronçon sous le cartouche",
        measurement_basis: null, basis_as_requested: false, counts_as: "distinct", confidence: 0.5 }],
    } : posteNotFound(entry));
    const built = await publication([], { call });

    expect(built.p_items).toEqual([]);
    expect(built.p_answers.find(({ item_id }) => item_id === VANNE.id)).toMatchObject({ outcome: "uncertain", quantity: null,
      candidate: null, reasons: [expect.objectContaining({ code: "SCALE_UNKNOWN" }), expect.objectContaining({ code: "BASIS_UNSTATED" })],
      observations: [expect.objectContaining({ page: 4, quantity: 8, role: "candidate", takeoff_item_id: null })] });
  });

  it("makes a positive row of each contribution only, linked to it; candidates and alternatives make none", async () => {
    const built = await publication();
    const observations = built.p_answers.flatMap((answer) => answer.observations.map((entry) => ({ ...entry, item: answer.item_id })));
    const contributions = observations.filter((entry) => entry.role === "contribution");
    expect(contributions.map((entry) => [entry.item, entry.page, entry.quantity])).toEqual([[LAVABO.id, 4, 3], [EF.id, 5, 12.5]]);
    expect(built.p_items.map((row) => row.id)).toEqual(contributions.map((entry) => entry.takeoff_item_id));
    expect(built.p_items[0]).toMatchObject({ designation: "Lavabo", quantity: 3, unit: "u", source_page: 4, source_file_name: "Plan RDC.pdf",
      is_excluded: false, exclusion_reason: null, metadata: { source_document: { kind: "plan_file", plan_file_id: PLAN },
        poste: { item_id: LAVABO.id, list_revision_id: REVISION, exchange: "v3", chunk_id: "f1-b1", method: "symbol_count" } } });
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
      extracted_json: { format: "item_list", schema_version: "v3", prompt_version: POSTE_EXCHANGE_PROMPT_VERSION,
        list: { revision_id: REVISION, revision: 3, item_count: 4 }, plan_pages: [3, 4, 5, 6] } });
  });
});

/** The order of a new measure of a selection, as its sealed manifest carries it and the worker reads it. */
function askedOrder(ids: string[]) {
  const order = { ...ORDER, list: { ...ORDER.list, asked_item_ids: ids } };
  return { ...SEALED, manifest: planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, vectorPages: 4 }], undefined, order),
    askedItemIds: ids };
}

describe("processItemListLevelC", () => {
  async function run(overrides: Partial<Parameters<typeof processItemListLevelC>[0]> = {}) {
    return processItemListLevelC({ supabase: database().client as never, job: job(), sourceFile: await sourceFile(), call: script,
      model: "controlled", order: SEALED,
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

  it("reads and publishes only the items a new measure of a selection asks, in the list's order", async () => {
    const call = controlledPosteCall();
    await run({ call, order: askedOrder([LAVABO.id, VANNE.id]) });
    const asked = call.received.flatMap(({ prompt }) => readPosteManifest(prompt).requested_posts.map(({ label }) => label));
    expect([...new Set(asked)].sort()).toEqual([LAVABO.label, VANNE.label].sort());
    const [, published] = vi.mocked(publishTakeoffItemAnswers).mock.calls[0];
    expect(published.p_answers.map((answer) => answer.item_id)).toEqual([LAVABO.id, VANNE.id]);
  });

  it("stops before any paid call when an item its request asks is not in its sealed list", async () => {
    const call = controlledPosteCall();
    await expect(run({ call, order: askedOrder([LAVABO.id, "cccccccc-0000-4000-8000-000000000009"]) }))
      .rejects.toMatchObject({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
    expect(call.received).toHaveLength(0);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  // The twin of the admission's case (launch-request-server.test.ts): the items asked, read in the sealed list's order,
  // make 4 batches on 11 fragments: 44 calls, above a plan's ceiling, refused before any call; the admission counts the same.
  it("bounds the items a new measure asks in the sealed list's order, as its admission sized them: 44 calls, refused", async () => {
    const call = controlledPosteCall();
    const list = orderSensitivePosteList();
    const asked = list.map(({ id }) => id).sort();
    const manifest = planManifest([{ id: PLAN, pageCount: 90 }], undefined,
      { ...ORDER, list: { ...ORDER.list, item_count: list.length, asked_item_ids: asked } });
    const whole = { ...await sourceFile(), bytes: await pdf(90), sourcePageNumbersByPage: Array.from({ length: 90 }, (_, index) => index + 1) };
    await expect(run({ call, supabase: database({ items: list, manifest }).client as never, sourceFile: whole,
      order: { ...SEALED, itemCount: list.length, manifest, askedItemIds: asked } })).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, retryable: false, details: expect.objectContaining({ reading_calls: 44 }),
      message: expect.stringContaining("Lecture de 48 postes sur 1 plan : 44 appels de lecture") });
    expect(call.received).toHaveLength(0);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
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

  it("publishes nothing when an answer is refused", async () => {
    const omitting = controlledPosteCall((entry) => entry.label === "Baignoire" ? "omit" : posteNotFound(entry));
    await expect(run({ call: omitting })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA,
      details: expect.objectContaining({ reason: "MISSING_ANSWER" }) });
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  // PR 3c closing round, point 5: once every call is paid, a renewal that could not be made (one transport error, which the
  // worker's renewal reports as a conflict) never discards the reading: the publication is sent, and the command, which
  // checks the lease under its lock, is the only one to say the lease is lost.
  it("publishes a finished reading after a renewal that could not be made, and ends only on the command's own answer", async () => {
    const unreachable = vi.fn(async () => {
      throw new TakeoffError({ code: TakeoffErrorCode.CONFLICT, message: "Le lease takeoff n'est plus disponible.", retryable: false });
    });
    await expect(run({ renewLease: unreachable })).resolves.toMatchObject({ status: "completed" });
    expect(publishTakeoffItemAnswers).toHaveBeenCalledTimes(1);
    vi.mocked(publishTakeoffItemAnswers).mockRejectedValueOnce(new TakeoffError({ code: TakeoffErrorCode.CONFLICT,
      message: "Le lease takeoff n'est plus disponible.", retryable: false }));
    await expect(run({ renewLease: unreachable })).rejects.toMatchObject({ code: TakeoffErrorCode.CONFLICT });
    expect(publishTakeoffItemAnswers).toHaveBeenCalledTimes(2);
  });

  // Fix round, point 11: the reads of the entries are counted first, so that a test of none of them cannot pass.
  it("reads a plan's sealed list again on each attempt, never another revision", async () => {
    const fake = database();
    await run({ supabase: fake.client as never });
    const reads = fake.queries.filter((query) => query.table === "takeoff_list_revision_entries");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((query) => query.filters.some((filter) => filter.column === "revision_id" && filter.value === REVISION))).toBe(true);
  });

  // Fix round, point 8: before its first paid call, the worker plans the reading it is about to make with the settings it
  // will use, counts every paid call (the vector classifier's included), and stops beyond the bounds with nothing spent.
  it("stops before any paid call when its own plan passes its share of the budget", async () => {
    const call = controlledPosteCall();
    const readVectors = vi.fn(async () => vectorOutcomes());
    // What the request has left is ample: only the share the request sealed for this plan stops it.
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 4, config: { thresholdPages: 1, chunkSizePages: 2, overlapPages: 1,
      maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 },
      requestBudget: { remainingTokens: 400_000, remainingCostCents: 2_500 } });
    const share = { tokens: 30_000, cost_cents: 2_500 };
    const thin = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 4,
      budget: share } } });
    const manifest = planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, vectorPages: 4, budget: share }]);
    await expect(run({ call, job: thin, readVectors, order: { ...SEALED, manifest } })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
      retryable: false, message: expect.stringContaining("Lecture de 4 postes sur 1 plan : 3 appels de lecture, environ 5 min sur un Mac.") });
    expect(call.received).toEqual([]);
    expect(readVectors).not.toHaveBeenCalled();
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  // Budget task: the classifier's calls count in its plan's budget (and its duration); its own limits bound them.
  it("counts its vector classifier's calls in its plan's budget", async () => {
    const call = controlledPosteCall();
    vi.mocked(takeoffVectorGroupCallsBound).mockReturnValueOnce(40);
    await expect(run({ call })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
      message: expect.stringContaining("1 appel de lecture et 40 de classification vectorielle au plus") });
    expect(vi.mocked(takeoffVectorGroupCallsBound)).toHaveBeenCalledWith(4);
    expect(call.received).toEqual([]);
  });

  // PR 3c fix round, point 4: the command requires the pages the request sealed; a plan whose PDF holds others (its stored
  // count of 2 for a PDF of 3 read whole) is stopped before its first paid call, never read then refused.
  // PR 3c closing round, points 2 and 4: the vector reading travels with the answers, and what the command or the first
  // order's end would refuse in it refuses the paid answers too. A vector page or a row the database cannot store (a text
  // with a NUL, a quantity beyond numeric(12,3) — a 1,000-point square at 1:100,000 reads 1,244,521,604.94 m² —, a
  // confidence above 1) is left out before sending, with a warning in the result; the answers are published.
  it("leaves out, with a warning, the vector pages and rows the database would refuse, and publishes the answers", async () => {
    const pageWithNul = { ...surfaceOutcome(4, [{ room: "Hall", quantity: 12 }]),
      record: { location: null, scale: { status: "verified", reason: "cartouche\u0000" }, mode: "vector", to_review: 0,
        labels: { incomplete: 0 } } as never };
    const rooms = surfaceOutcome(6, [{ room: "Cuisine", quantity: 1_244_521_604.94 }, { room: "Cellier", quantity: 8, confidence: 1.5 },
      { room: "Salon", quantity: 21.5 }]);
    await expect(run({ readVectors: async () => [pageWithNul, ...vectorOutcomes(), rooms] })).resolves.toMatchObject({ status: "completed" });
    const [, published] = vi.mocked(publishTakeoffItemAnswers).mock.calls[0];
    const vector = published.p_vector!;
    expect(vector.pages.map((page) => page.source_page)).toEqual([5, 6]);
    expect(vector.items.map((item) => [item.source_page, item.designation])).toEqual([[5, "EF cuivre DN 22"], [6, "Surface « Salon »"]]);
    expect(storableVector(vector, new Set(published.p_items.map((item) => item.id)))).toBe(true);
    expect(published.p_result.warnings.filter((warning) => warning.code === "POSTE_VECTEUR_ECARTE")).toEqual([
      { code: "POSTE_VECTEUR_ECARTE", severity: "warning", message: "La lecture vectorielle de la page 4 n’a pas pu être gardée : elle n’est pas reprise." },
      { code: "POSTE_VECTEUR_ECARTE", severity: "warning", message: "2 lectures vectorielles de la page 6 sont hors de ce que le métré enregistre : elles ne sont pas reprises." },
    ]);
    const rows = new Set(vector.items.map((item) => item.id));
    expect(published.p_answers.flatMap((answer) => answer.observations).filter((entry) => entry.source === "vector")
      .every((entry) => rows.has(entry.vector_key!))).toBe(true);
  });

  it("stops before any paid call when the pages it would read are not those its request sealed", async () => {
    const call = controlledPosteCall();
    const manifest = planManifest([{ id: PLAN, pageCount: 2, vectorPages: 4 }]);
    const whole = { ...(await sourceFile()), bytes: await pdf(3), sourcePageNumbersByPage: undefined };
    await expect(run({ call, sourceFile: whole, order: { ...SEALED, manifest } })).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_PREPARATION_SOURCE_CHANGED, retryable: false,
      message: expect.stringContaining("Les pages de ce plan ne sont plus celles que sa demande a scellées") });
    expect(call.received).toEqual([]);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  // Budget task: the attempt of a reading against the list spends from the share its request sealed for it, sized from its
  // admitted calls, never within the first format's per-job budget (400,000 tokens: 14 calls).
  it("plans its reading within the share its request sealed for it, past the first format's per-job budget", async () => {
    const call = controlledPosteCall();
    const items = Array.from({ length: 600 }, (_, index) => poste(100 + index, `Robinet ${index + 1}`));
    // One fragment of the 4-page plan times 15 batches: 15 calls, a share of 900,000 tokens, the request's whole envelope.
    const share = { tokens: 15 * 30_000 * 2, cost_cents: 2_500 };
    const manifest = planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, budget: share }], share,
      { ...ORDER, list: { ...ORDER.list, item_count: 600 } });
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 4, config: { thresholdPages: 15, chunkSizePages: 10,
      overlapPages: 2, maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 },
      requestBudget: { remainingTokens: 900_000, remainingCostCents: 2_500 } });
    const own = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 0,
      budget: share } } });
    await run({ call, job: own, supabase: database({ items }).client as never, order: { ...SEALED, itemCount: 600, manifest } });
    expect(call.received).toHaveLength(15);
    expect(publishTakeoffItemAnswers).toHaveBeenCalledTimes(1);
  });

  it("stops before any paid call when what its request has left cannot start its plan's calls", async () => {
    const call = controlledPosteCall();
    const items = Array.from({ length: 600 }, (_, index) => poste(100 + index, `Robinet ${index + 1}`));
    const share = { tokens: 15 * 30_000 * 2, cost_cents: 2_500 };
    const manifest = planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, budget: share }], share,
      { ...ORDER, list: { ...ORDER.list, item_count: 600 } });
    // An earlier attempt spent 500,000 tokens of the share: the 15th call would find nothing left.
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 4, config: { thresholdPages: 15, chunkSizePages: 10,
      overlapPages: 2, maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 },
      requestBudget: { remainingTokens: 400_000, remainingCostCents: 2_500 } });
    const own = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 0,
      budget: share } } });
    await expect(run({ call, job: own, supabase: database({ items }).client as never, order: { ...SEALED, itemCount: 600, manifest } }))
      .rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED, retryable: false,
        message: expect.stringContaining("Le budget qui reste à cette analyse ne permet plus ses appels") });
    expect(call.received).toEqual([]);
  });

  // Owner decision of 2026-11-27: a request paid by a personal key is bounded by its dollar ceiling alone. A one-page plan
  // read against the list bounds 25 calls of the vector classifier beside its own: 26 calls, 780,000 tokens at the ledger's
  // estimate, past the tenant's default of 400,000 its mandate used to carry. It was stopped before any call
  // (TAKEOFF_LEVEL_C_BUDGET_EXCEEDED); it is read, whatever token number its mandate was sealed with.
  it.each([["without a token ceiling", null], ["with the former token ceiling", 400_000]] as const)(
    "reads a one-page plan against the list with a personal key at the default budget, its mandate sealed %s", async (_label, maxTokens) => {
      keyMandate.maxTokens = maxTokens;
      const actual = await vi.importActual<typeof import("@/lib/takeoff/level-c-reading")>("@/lib/takeoff/level-c-reading");
      vi.mocked(prepareLevelCReading).mockImplementationOnce(actual.prepareLevelCReading);
      vi.mocked(takeoffVectorGroupCallsBound).mockReturnValueOnce(25);
      const call = controlledPosteCall();
      // Sized as its admission sizes it: 26 calls at the ledger's estimate, times the margin.
      const share = { tokens: 26 * 30_000 * 2, cost_cents: 2_500 };
      const manifest = planManifest([{ id: PLAN, pageCount: 1, vectorPages: 1, budget: share }], share);
      const mandateId = "aaaaaaaa-0000-4000-8000-000000000091";
      const own = job({ preparation_snapshot: {
        execution_selection: { source: "personal_api_key", profileId: mandateId, authorizationId: mandateId, model: "personal_api_key",
          reasoningEffort: null, hostId: "urn:uuid:aaaaaaaa-0000-8000-8000-000000000099" },
        launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 1, budget: share } } });
      const onePage = { ...(await sourceFile()), bytes: await pdf(1), sourcePageNumbersByPage: [1] };
      const result = await run({ call, job: own, sourceFile: onePage, readVectors: async () => [], order: { ...SEALED, manifest } });
      expect(vi.mocked(takeoffVectorGroupCallsBound)).toHaveBeenCalledWith(1);
      expect(call.received).toHaveLength(1);
      expect(publishTakeoffItemAnswers).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "completed", pageCount: 1 });
    });

  // The dollar ceiling stays the key's bound, checked on what the calls of the attempt cost.
  it("stops a reading paid by a personal key once its calls cost more than the dollar ceiling its mandate sealed", async () => {
    keyMandate.maxTokens = null;
    const actual = await vi.importActual<typeof import("@/lib/takeoff/level-c-reading")>("@/lib/takeoff/level-c-reading");
    vi.mocked(prepareLevelCReading).mockImplementationOnce(actual.prepareLevelCReading);
    const answered = controlledPosteCall();
    const call = Object.assign(async (options: Parameters<typeof answered>[0]) => ({ ...(await answered(options)), costCents: 2_501 }),
      { received: answered.received });
    const share = { tokens: 2 * 30_000 * 2, cost_cents: 2_500 };
    const manifest = planManifest([{ id: PLAN, pageCount: 1, budget: share }], share);
    const mandateId = "aaaaaaaa-0000-4000-8000-000000000091";
    const own = job({ preparation_snapshot: {
      execution_selection: { source: "personal_api_key", profileId: mandateId, authorizationId: mandateId, model: "personal_api_key",
        reasoningEffort: null, hostId: "urn:uuid:aaaaaaaa-0000-8000-8000-000000000099" },
      launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 0, budget: share } } });
    const onePage = { ...(await sourceFile()), bytes: await pdf(1), sourcePageNumbersByPage: [1] };
    await expect(run({ call: call as never, job: own, sourceFile: onePage, readVectors: async () => [], order: { ...SEALED, manifest } }))
      .rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED });
    expect(call.received).toHaveLength(1);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  // Closing round, point 7: the re-check plans the whole request as today's settings plan it, every unit of its manifest,
  // never its own plan only.
  // PR 3c fix round, point 1: the worker plans its plan's fragments again before its first paid call: more than one answer
  // holds (POSTE_READING_MAX_FRAGMENTS) and nothing is read, even within the calls' ceilings and the budget.
  it("stops before any paid call when today's fragmenting reads its plan in more fragments than one answer holds", async () => {
    const call = controlledPosteCall();
    const share = { tokens: 2_000_000, cost_cents: 125 };
    // Admitted on two fragments of a 20-page plan; today's settings make 20 one-page fragments: 20 calls of one batch.
    const manifest = planManifest([{ id: PLAN, pageCount: 20, budget: share }], share);
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 20, config: { thresholdPages: 1, chunkSizePages: 1, overlapPages: 0,
      maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 125 },
      requestBudget: { remainingTokens: 2_000_000, remainingCostCents: 125 } });
    const twenty = { ...(await sourceFile()), bytes: await pdf(20), sourcePageNumbersByPage: Array.from({ length: 20 }, (_, page) => page + 1) };
    const own = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 0,
      budget: share } } });
    await expect(run({ call, job: own, sourceFile: twenty, order: { ...SEALED, manifest } })).rejects.toMatchObject({
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, retryable: false,
      message: expect.stringContaining("40 par plan et 19 pages par plan : réduisez les plans ou les pages à lire.") });
    expect(call.received).toEqual([]);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  // PR 3c closing round, point 1: the worker plans the bytes of its plan's answers again before its first paid call: 1,200
  // items on its 4 pages could publish more than the command stores (1,161 at most), and nothing is read.
  it("stops before any paid call when its plan's answers could pass what the command stores", async () => {
    const call = controlledPosteCall();
    const items = Array.from({ length: 1_200 }, (_, index) => poste(100 + index, `Robinet ${index + 1}`));
    const share = { tokens: 100_000_000, cost_cents: 2_500 };
    const manifest = planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, budget: share }], share,
      { ...ORDER, list: { ...ORDER.list, item_count: 1_200 } });
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 4, config: { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2,
      maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 },
      requestBudget: { remainingTokens: 100_000_000, remainingCostCents: 2_500 } });
    const own = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 0,
      budget: share } } });
    await expect(run({ call, job: own, supabase: database({ items }).client as never, order: { ...SEALED, itemCount: 1_200, manifest } }))
      .rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, retryable: false,
        details: expect.objectContaining({ exceeded: expect.arrayContaining(["publication_bytes"]) }) });
    expect(call.received).toEqual([]);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  it("stops before any paid call when the whole request, planned with today's settings, passes its ceiling", async () => {
    const call = controlledPosteCall();
    const items = Array.from({ length: 200 }, (_, index) => poste(100 + index, `Robinet ${index + 1}`));
    const plans = [PLAN, ...Array.from({ length: 19 }, (_, index) => `aaaaaaaa-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`)];
    // 2M tokens a plan. Admitted on one fragment of each 12-page plan times five batches: 100 calls. Today's settings make
    // 5 fragments of a 12-page plan: 25 calls a plan, within its ceiling and its share, 500 for the request.
    const share = { tokens: 2_000_000, cost_cents: 125 };
    const manifest = planManifest(plans.map((id) => ({ id, pageCount: 12, budget: share })), { tokens: 40_000_000, cost_cents: 2_500 },
      { ...ORDER, list: { ...ORDER.list, item_count: 200 } });
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 12, config: { thresholdPages: 1, chunkSizePages: 4, overlapPages: 2,
      maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 125 },
      requestBudget: { remainingTokens: 2_000_000, remainingCostCents: 125 } });
    const twelve = { ...(await sourceFile()), bytes: await pdf(12), sourcePageNumbersByPage: Array.from({ length: 12 }, (_, page) => page + 1) };
    const own = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 0,
      budget: share } } });
    await expect(run({ call, job: own, sourceFile: twelve, supabase: database({ items }).client as never,
      order: { ...SEALED, itemCount: 200, manifest } })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      retryable: false, message: expect.stringContaining("Lecture de 200 postes sur 20 plans : 500 appels de lecture") });
    expect(call.received).toEqual([]);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });
});
