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
import { createSupabaseFake, servedRows, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { POSTE_EXCHANGE_PROMPT_VERSION } from "@/lib/takeoff/poste-exchange";
import type { TakeoffPlanLaunchManifest } from "@/lib/takeoff/launch-request";
import type { Poste } from "@/lib/takeoff/poste-list";
import { logCompletedAuditEvent } from "@/lib/takeoff/processing-audit";
import { buildTakeoffItemAnswersPublication, publishTakeoffItemAnswers } from "@/lib/takeoff/poste-publication-server";
import { finishPlanReading, posteVectorReadings, readPlanAgainstItemList } from "@/lib/takeoff/poste-reading";
import { processItemListLevelC, readTakeoffItemListOrder } from "@/lib/takeoff/poste-reading-job-server";
import { controlledPosteCall, posteMeasured, posteNotFound } from "@/lib/takeoff/poste-reading.test-fixtures";
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
const SEALED = { requestId: REQUEST, revisionId: REVISION, revision: 3, itemCount: 4, contentSha256: "e".repeat(64), manifest: MANIFEST };

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
    snapshot?: TakeoffJobProcessingRow["preparation_snapshot"];
    plan?: (plan: ReturnType<typeof finishPlanReading>) => ReturnType<typeof finishPlanReading> } = {}) {
    const file = await sourceFile();
    const items = options.items ?? ITEMS;
    const reading = await readPlanAgainstItemList({ call: options.call ?? script, job: job(), items, listRevision: 3, model: "controlled",
      config: { thresholdPages: 15, chunkSizePages: 10, overlapPages: 2, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 },
      pdf: { fileName: file.fileName, bytes: file.bytes, originalPageNumbers: file.sourcePageNumbersByPage } });
    const read = finishPlanReading(reading, items, posteVectorReadings(vectors, PLAN), JOB);
    const plan = options.plan ? options.plan(read) : read;
    const owned = options.snapshot === undefined ? job() : job({ preparation_snapshot: options.snapshot });
    return buildTakeoffItemAnswersPublication({ job: owned, items, list: { revisionId: REVISION, revision: 3, itemCount: items.length }, reading,
      plan, planFile: { kind: "plan_file", plan_file_id: PLAN }, fileName: file.fileName, mimeType: file.mimeType, vectorOutcomes: vectors,
      runMetrics: [], model: "controlled", completedAt: new Date("2026-11-22T09:00:00.000Z"), totalDurationMs: 1_000 });
  }

  // #461: the command keeps at most 2000 findings outside the list; the result says how many more the reading saw.
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
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 4, config: { thresholdPages: 1, chunkSizePages: 2, overlapPages: 1,
      maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 400_000, maxCostCents: 2_500 } });
    const share = { tokens: 30_000, cost_cents: 2_500 };
    const thin = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 4,
      budget: share } } });
    const manifest = planManifest([{ id: PLAN, pages: [3, 4, 5, 6], pageCount: 6, vectorPages: 4, budget: share }]);
    await expect(run({ call, job: thin, readVectors, order: { ...SEALED, manifest } })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED,
      retryable: false, message: expect.stringContaining("Lecture de 4 postes sur 1 plan : 3 appels prévus") });
    expect(call.received).toEqual([]);
    expect(readVectors).not.toHaveBeenCalled();
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });

  it("counts its vector classifier's calls against the ceiling of a plan", async () => {
    const call = controlledPosteCall();
    vi.mocked(takeoffVectorGroupCallsBound).mockReturnValueOnce(40);
    await expect(run({ call })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: expect.stringContaining("41 appels prévus") });
    expect(vi.mocked(takeoffVectorGroupCallsBound)).toHaveBeenCalledWith(4);
    expect(call.received).toEqual([]);
  });

  // Closing round, point 7: the re-check plans the whole request as today's settings plan it, every unit of its manifest,
  // never its own plan only.
  it("stops before any paid call when the whole request, planned with today's settings, passes its ceiling", async () => {
    const call = controlledPosteCall();
    const items = Array.from({ length: 80 }, (_, index) => poste(100 + index, `Robinet ${index + 1}`));
    const plans = [PLAN, ...Array.from({ length: 9 }, (_, index) => `aaaaaaaa-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`)];
    // 7M tokens, 700,000 a plan. Admitted on one fragment of each 12-page plan times two batches: 20 calls. Today's settings
    // make 11 fragments of a 12-page plan: 22 calls a plan, within its ceiling and its share, 220 for the request.
    const share = { tokens: 700_000, cost_cents: 250 };
    const manifest = planManifest(plans.map((id) => ({ id, pageCount: 12, budget: share })), { tokens: 7_000_000, cost_cents: 2_500 },
      { ...ORDER, list: { ...ORDER.list, item_count: 80 } });
    vi.mocked(prepareLevelCReading).mockResolvedValueOnce({ pageCount: 12, config: { thresholdPages: 1, chunkSizePages: 2, overlapPages: 1,
      maxPdfPages: 200, timeoutMs: 300_000, maxTotalTokens: 7_000_000, maxCostCents: 2_500 } });
    const twelve = { ...(await sourceFile()), bytes: await pdf(12), sourcePageNumbersByPage: Array.from({ length: 12 }, (_, page) => page + 1) };
    const own = job({ preparation_snapshot: { launch_unit: { request_id: REQUEST, key: `plan:${PLAN}`, ordinal: 1, vector_pages: 0,
      budget: share } } });
    await expect(run({ call, job: own, sourceFile: twelve, supabase: database({ items }).client as never,
      order: { ...SEALED, itemCount: 80, manifest } })).rejects.toMatchObject({ code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      retryable: false, message: expect.stringContaining("Lecture de 80 postes sur 10 plans : 220 appels prévus") });
    expect(call.received).toEqual([]);
    expect(publishTakeoffItemAnswers).not.toHaveBeenCalled();
  });
});
