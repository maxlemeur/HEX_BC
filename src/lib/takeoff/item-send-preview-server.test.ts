import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/takeoff/job-read-server", () => ({ getAuthenticatedTakeoffContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/item-send-facts-server", () => ({ readItemSendFacts: vi.fn(), readItemSendEarlierState: vi.fn() }));
vi.mock("@/lib/takeoff/mapping-rules-server", () => ({ listActiveTakeoffMappingRules: vi.fn() }));
vi.mock("@/lib/takeoff/plan-location-server", () => ({ readTakeoffJobPlanLocations: vi.fn() }));
vi.mock("@/lib/estimates/calc-policy-server", () => ({ readTenantCalcPolicy: vi.fn(), ABSENT_TENANT_CALC_POLICY: {
  engine: 3, defaultSaleCoefficientFo: null, defaultSaleCoefficientMo: null, allowedTaxRatesBp: [2000] } }));
vi.mock("@/lib/estimates/canonical-v2-creation", () => ({ prepareCanonicalEstimateCreation: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-repository", () => ({ readDpgfMappedFacts: vi.fn() }));
vi.mock("@/lib/takeoff/send-server", () => ({ firstDraftSettings: (payload: Record<string, unknown>) => ({ ...payload }) }));

import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { prepareCanonicalEstimateCreation } from "@/lib/estimates/canonical-v2-creation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readDpgfMappedFacts } from "@/lib/takeoff/dpgf-comparison-repository";
import { TakeoffError } from "@/lib/takeoff/errors";
import { itemSendPreviewResponseSchema } from "@/lib/takeoff/item-send-contracts";
import { confirmTakeoffItemSend, mapItemSendRpcError } from "@/lib/takeoff/item-send-confirm-server";
import { readItemSendEarlierState, readItemSendFacts, type ItemSendReading } from "@/lib/takeoff/item-send-facts-server";
import { computeItemSendState, previewTakeoffItemSend } from "@/lib/takeoff/item-send-preview-server";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { listActiveTakeoffMappingRules } from "@/lib/takeoff/mapping-rules-server";
import { readTakeoffJobPlanLocations } from "@/lib/takeoff/plan-location-server";
import type { TakeoffMappingRule } from "@/lib/takeoff/types";

// Lot 4, PR 5a/5b: the read-only preview of a send by item and its confirmation. The clients read in-memory tables
// through every filter (a joined column included), refuse every write and every call but the named read functions (and,
// for the server's client only, the writer the confirmation calls), and record what they read and call. A second
// tenant, a second affaire and a second version hold rows the preview must never read. Fictional affaire, plan and
// quantities.

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "11111111-1111-4111-8111-111111111112";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT = "33333333-3333-4333-8333-333333333334";
const JOB = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const REVISION = "66666666-6666-4666-8666-666666666666";
const VERSION = "77777777-7777-4777-8777-777777777777";
const OTHER_VERSION = "77777777-7777-4777-8777-777777777778";
const PLAN_FILE = "88888888-8888-4888-8888-888888888888";
const LAVABO = "99999999-9999-4999-8999-999999999991";
const DPGF_ITEM = "99999999-9999-4999-8999-999999999992";
const ANSWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const LINE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const FOREIGN_LINE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const IMPORT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const MAPPED_OLD = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const MAPPED_NEW = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const RAW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const ASSEMBLY = "ffffffff-ffff-4fff-8fff-fffffffffff1";

type Row = Record<string, unknown>;
type Calls = { reads: Array<{ client: string; table: string; select: string }>; writes: string[]; rpcs: string[] };

/** The read functions granted to the service role only: a member's session may call none of them. */
const SERVICE_READ_FUNCTIONS = ["read_estimate_dpgf_raw_rows", "takeoff_rule_job_stamp", "takeoff_send_peers_stamp", "read_takeoff_send_context",
  "dpgf_import_review_state", "takeoff_mapping_rules_stamp"];
/** The writer: the service role's only (public.send_takeoff_item_plan), never a member's session. */
const WRITER = "send_takeoff_item_plan";
/** What the API gives at most per answer when no range is asked (PostgREST's max-rows). */
const MAX_ROWS = 1000;

const valueOf = (row: Row, column: string) => column.split(".").reduce<unknown>((value, key) => (value && typeof value === "object"
  ? (value as Row)[key] : undefined), row);

/** Rows read through every filter, in the order asked, cut at the API's ceiling when no range is asked. */
function query(source: () => Row[], record: (columns: string) => void, refuse: (call: string) => never) {
  const filters: Array<(row: Row) => boolean> = [];
  const orders: string[] = [];
  let slice: [number, number] | null = null;
  let limit: number | null = null;
  const result = () => {
    const rows = source().filter((row) => filters.every((filter) => filter(row)));
    const sorted = orders.length === 0 ? rows : [...rows].sort((left, right) => {
      for (const column of orders) {
        const [a, b] = [String(valueOf(left, column) ?? ""), String(valueOf(right, column) ?? "")];
        if (a !== b) return a < b ? -1 : 1;
      }
      return 0;
    });
    const shown = slice ? sorted.slice(slice[0], Math.min(slice[1] + 1, slice[0] + MAX_ROWS))
      : sorted.slice(0, Math.min(limit ?? MAX_ROWS, MAX_ROWS));
    return { data: shown, error: null, count: rows.length };
  };
  const builder = {
    select: (columns: string) => { record(columns); return builder; },
    eq: (column: string, value: unknown) => { filters.push((row) => valueOf(row, column) === value); return builder; },
    in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(valueOf(row, column))); return builder; },
    order: (column: string) => { orders.push(column); return builder; },
    limit: (count: number) => { limit = count; return builder; },
    range: (from: number, to: number) => { slice = [from, to]; return builder; },
    maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    insert: () => refuse("insert"), update: () => refuse("update"), upsert: () => refuse("upsert"), delete: () => refuse("delete"),
  };
  return builder;
}

/** A client over in-memory tables: every filter applies (a dotted column reads the joined row), every write is refused. */
function fakeClient(name: string, tables: Record<string, Row[]>, functions: Record<string, (args: Row) => Row[] | unknown>, calls: Calls,
  allowed: readonly string[]) {
  return {
    rpc: (fn: string, args: Row) => {
      calls.rpcs.push(`${name}:${fn}`);
      if (!allowed.includes(fn) || !functions[fn]) {
        calls.writes.push(`${name}:rpc:${fn}`);
        throw new Error(`${name}: rpc ${fn} refusé dans un aperçu`);
      }
      const answer = functions[fn](args);
      if (!Array.isArray(answer)) return Promise.resolve({ data: answer, error: null });
      return query(() => answer as Row[], () => undefined, (call) => { throw new Error(`${name}: ${call} refusé`); });
    },
    from(table: string) {
      return query(() => tables[table] ?? [], (columns) => calls.reads.push({ client: name, table, select: columns }), (call) => {
        calls.writes.push(`${name}:${call}:${table}`);
        throw new Error(`${name}: ${call} refusé`);
      });
    },
  };
}

const lavabo = { id: LAVABO, label: "Lavabo", expectedUnit: "u", measurementBasis: null, qualifiers: {},
  sections: [{ id: "lot", title: "Plomberie", order: 1 }, { id: "sanitaires", title: "Appareils sanitaires", order: 2 }],
  referenceQuantity: null, origin: { kind: "template" as const, templateId: "plomberie", version: 1, familyId: "sanitaires", lineId: "lavabo" } };
const dpgfLavabo = { ...lavabo, id: DPGF_ITEM, sections: [{ id: "lot", title: "Plomberie", order: 1 }], referenceQuantity: 4,
  origin: { kind: "dpgf" as const, importId: IMPORT, mappingId: "mapping-1", rawRowId: RAW, mappedRowId: MAPPED_OLD, rowIndex: 3,
    sheetName: null, sourceRowNumber: 3, sourcePage: null, tableIndex: null, documentId: null, reference: "1.2", sourceUnit: "u",
    measurementNotesDigest: null, factsDigest: "facts" } };

function reading(item: typeof lavabo | typeof dpgfLavabo = lavabo, answer: Partial<ItemSendReading["answers"][number]> = {}): ItemSendReading {
  return { items: [item], scope: [item.id], affaireEntries: [], answers: [{ itemId: item.id, answerId: ANSWER, revision: "r1",
    outcome: "measured", decision: { kind: "accepted", revision: 1 }, entry: null,
    observations: [{ observationId: "obs-1", role: "contribution", source: "model", quantity: 3, unit: "u", page: 2, measurementBasis: null }],
    ...answer }] };
}

function manifest(order: "item_list" | "free_extraction", format: 1 | 2 = 2) {
  return { format_version: format, intent: "initial",
    order: order === "item_list" ? { kind: "item_list", version: 2, list: { revision_id: REVISION, revision: 3, content_sha256: "c".repeat(64),
      item_count: 1 } } : { kind: "free_extraction", version: 1, list: null },
    units: [{ key: "unit-1", ordinal: 1, plans: [PLAN_FILE], pages: [], page_count: 4, budget: { tokens: 1, cost_cents: 1 }, vector_pages: 0 }],
    plans: [{ entry_key: PLAN_FILE, name: "Plan RDC", logical_id: "piece-1", intake_document_id: null, plan_file_id: PLAN_FILE, generation: "1",
      content_sha256: "d".repeat(64), pages: [], page_count: 4 }] };
}

const version = (id: string, engine: number, project = PROJECT, tenant = TENANT) => ({ id, tenant_id: tenant, project_id: project,
  version_number: 1, status: "draft", title: null, variant_label: null, updated_at: "2026-11-22T08:00:00.000Z", calc_engine_version: engine,
  max_section_depth: 3 });

const dpgfRow = (id: string, mapped: string, overrides: Row = {}) => ({ id, tenant_id: TENANT, version_id: VERSION, parent_id: null,
  item_type: "line", position: 1, title: "Lavabo", unit_code: "u", pricing_status: "priced", quantity: 4, updated_at: "2026-11-22T08:00:00.000Z",
  source_provider: "dpgf", mapped_row_id: mapped, import_id: IMPORT, dpgf_source_quantity: 4, quantity_policy: null, ...overrides });

let calls: Calls;
let written: Row[];
function setUp(input: { manifest?: unknown; versions?: Row[]; items?: Row[]; role?: string; lineage?: Row[]; mapped?: Row[];
  measureReviews?: Row[]; sources?: unknown; locations?: Row[]; receipts?: Row[]; writer?: (args: Row) => unknown; sent?: boolean }) {
  written = [];
  calls = { reads: [], writes: [], rpcs: [] };
  const shared: Record<string, Row[]> = {
    takeoff_launch_requests: [{ id: REQUEST, tenant_id: TENANT, manifest: input.manifest ?? manifest("item_list") },
      { id: REQUEST, tenant_id: OTHER_TENANT, manifest: manifest("free_extraction") }],
    estimate_projects: [{ id: PROJECT, tenant_id: TENANT, user_id: MEMBER, is_archived: false },
      { id: OTHER_PROJECT, tenant_id: TENANT, user_id: MEMBER, is_archived: false }],
    // Another affaire's draft and another tenant's version of the same affaire id: never this send's destinations.
    estimate_versions: [...(input.versions ?? []), version(OTHER_VERSION, 3, OTHER_PROJECT), version(OTHER_VERSION, 3, PROJECT, OTHER_TENANT)],
    estimate_items: [...(input.items ?? []), dpgfRow(FOREIGN_LINE, MAPPED_OLD, { tenant_id: OTHER_TENANT }),
      dpgfRow(FOREIGN_LINE, MAPPED_OLD, { version_id: OTHER_VERSION })],
    dpgf_rows_mapped: input.mapped ?? [],
    dpgf_imports: [{ id: IMPORT, tenant_id: TENANT, project_id: PROJECT, updated_at: "2026-11-22T07:00:00.000Z", status: "done", row_count: 3 }],
    takeoff_plan_locations: input.locations ?? [],
    estimate_assemblies: [{ id: ASSEMBLY, tenant_id: TENANT, name: "Ouvrage lavabo complet" },
      { id: ASSEMBLY, tenant_id: OTHER_TENANT, name: "Ouvrage d’un autre" }],
  };
  const functions: Record<string, (args: Row) => unknown> = {
    read_takeoff_measure_destination_reviews: () => input.measureReviews ?? [],
    read_estimate_dpgf_raw_rows: (args) => (args.p_tenant_id === TENANT && args.p_version_id === VERSION ? input.lineage ?? [] : []),
    dpgf_import_review_state: (args) => (args.p_tenant_id === TENANT ? [{ mapping_id: "mapping-1", column_mapping: {}, rows_sha256: "r".repeat(64) }] : []),
    takeoff_rule_job_stamp: () => "job-stamp",
    takeoff_send_peers_stamp: () => "peers-stamp",
    read_takeoff_send_context: () => ({ peers: [], plans: [], stamps: { peers: "p", locations: "l" }, display: null }),
    takeoff_mapping_rules_stamp: () => "mapping-stamp",
    [WRITER]: (args) => {
      written.push(args);
      if (input.writer) return input.writer(args);
      return { receipt_id: "abababab-abab-4bab-8bab-abababababab", replayed: false, format: "takeoff_item_send", format_version: 1,
        job_id: JOB, version_id: VERSION, version_created: true, sections_created: [], lines: [], lines_written: 1, parts_written: 1,
        parts_replaced: 0, page_decisions: [], focus_item_id: LINE, override: null, rules: [] };
    },
  };
  const member = fakeClient("member", { ...shared, takeoff_item_send_receipts: input.receipts ?? [], takeoff_jobs: [{ id: JOB, tenant_id: TENANT, project_id: PROJECT,
    estimate_version_id: input.sent ? VERSION : null, status: input.sent ? "applied" : "completed", launch_request_id: REQUEST,
    launch_unit_key: "unit-1", sources: input.sources ?? null },
  { id: JOB, tenant_id: OTHER_TENANT, project_id: OTHER_PROJECT, estimate_version_id: null, status: "completed",
    launch_request_id: REQUEST, launch_unit_key: "unit-1", sources: null }] }, functions, calls, ["read_takeoff_measure_destination_reviews"]);
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: member, tenantId: TENANT, userId: MEMBER,
    tenantRole: input.role ?? "admin" } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(fakeClient("service", shared, functions, calls, [...SERVICE_READ_FUNCTIONS, WRITER]) as never);
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(TakeoffError);
  return error as TakeoffError;
}

const readTables = () => [...new Set(calls.reads.map((read) => `${read.client}:${read.table}`))].sort();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading() });
  vi.mocked(readItemSendEarlierState).mockResolvedValue({ targets: [], sections: [], displaced: [], pagesInEstimate: [] });
  vi.mocked(listActiveTakeoffMappingRules).mockResolvedValue([]);
  vi.mocked(readTenantCalcPolicy).mockResolvedValue({ engine: 3, defaultSaleCoefficientFo: null, defaultSaleCoefficientMo: null,
    allowedTaxRatesBp: [2000] } as never);
  vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: { calc_engine_version: 3, max_section_depth: 3,
    sale_coefficient_fo: 1.3 } } as never);
  vi.mocked(readDpgfMappedFacts).mockResolvedValue(new Map());
  vi.mocked(readTakeoffJobPlanLocations).mockResolvedValue({ plans: [] } as never);
});

describe("previewTakeoffItemSend", () => {
  it("returns the failed save when the transaction declines the analysis reference", () => {
    expect(mapItemSendRpcError({ code: "M0A01", message: "database diagnostic" }, JOB)).toMatchObject({
      status: 400, code: "ESTIMATE_ANALYSIS_OUT_OF_SCOPE", message: "Cette version du devis ne détient pas cette analyse.",
    });
  });

  it("refuses a takeoff not read against the list: today's send stays the way to send it", async () => {
    for (const sealed of [manifest("free_extraction"), manifest("item_list", 1)]) {
      setUp({ manifest: sealed });
      const error = await refusal(previewTakeoffItemSend(JOB, {}));
      expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_not_item_list"]);
    }
    expect(readItemSendFacts).not.toHaveBeenCalled();
  });

  it("says the answers are not stored yet, and writes nothing", async () => {
    setUp({});
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "not_stored" });
    const error = await refusal(previewTakeoffItemSend(JOB, {}));
    expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_answers_not_stored"]);
    expect(calls.writes).toEqual([]);
  });

  it("previews the first draft it would create, its sections and lines, and writes nothing", async () => {
    setUp({});
    const preview = itemSendPreviewResponseSchema.parse(await previewTakeoffItemSend(JOB, {}));
    expect(preview).toEqual(expect.objectContaining({ version_created: true, destination: { kind: "first_draft" }, engine: 3, blocked: null,
      confirmable: true, breakdown: "together" }));
    expect(preview.sections.map((section) => section.title)).toEqual(["Plomberie", "Appareils sanitaires"]);
    expect(preview.lines).toEqual([expect.objectContaining({ item_id: LAVABO, change: "created", quantity_before: null, quantity_after: 3,
      pages: [2] })]);
    expect(preview.plan_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(readItemSendFacts).toHaveBeenCalledWith(expect.anything(), { jobId: JOB, projectId: PROJECT,
      list: { revisionId: REVISION, revision: 3, itemCount: 1 } });
    expect(calls.writes).toEqual([]);
  });

  it("binds consent to the reconciliation shown, including its answer revision, while preserving the released preview", async () => {
    const review = { target: LAVABO + "|together", answer_id: ANSWER, decision_revision: 1, version_id: null,
      line_id: null, matched: false, reference: null, measured: 3, gap: null, quantity_after: 3, unit: "u" };
    setUp({ measureReviews: [review] });
    const released = await previewTakeoffItemSend(JOB, {});
    expect(released).not.toHaveProperty("measure_reviews");
    expect(calls.rpcs).not.toContain("member:read_takeoff_measure_destination_reviews");
    const preview = await previewTakeoffItemSend(JOB, { review_measures: true });
    expect(preview.measure_reviews).toEqual([review]);
    expect(preview.plan_digest).not.toBe(released.plan_digest);
    const request = { review_measures: true, request_id: REQUEST, plan_digest: preview.plan_digest };
    expect((await refusal(confirmTakeoffItemSend(JOB, request))).details).toMatchObject({ reason: "measure_reconciliation_changed" });
    setUp({ measureReviews: [{ ...review, decision_revision: 2 }] });
    expect((await refusal(confirmTakeoffItemSend(JOB, { ...request, measure_reviews_checked: true }))).status).toBe(409);
    expect(written).toEqual([]);
  });

  it("puts the first draft's settings in the digest: other settings, another plan (fix 11)", async () => {
    setUp({});
    const first = (await previewTakeoffItemSend(JOB, {})).plan_digest;
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: { calc_engine_version: 3, max_section_depth: 3,
      sale_coefficient_fo: 1.25 } } as never);
    setUp({});
    expect((await previewTakeoffItemSend(JOB, {})).plan_digest).not.toBe(first);
  });

  it("checks engine 3 at the preview and names the reason, reading no plan location for « Ensemble »", async () => {
    setUp({ versions: [version(VERSION, 2)] });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked).toEqual(expect.objectContaining({ reason: "engine_not_v3" }));
    expect(preview.blocked!.message).toContain("moteur 3");
    expect(preview.lines).toEqual([]);
    expect(readTakeoffJobPlanLocations).not.toHaveBeenCalled();
    expect(calls.writes).toEqual([]);
  });

  it("points to the confirmed import of the DPGF for a draft without its lines, and imports nothing", async () => {
    setUp({ versions: [version(VERSION, 3)] });
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading(dpgfLavabo) });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked).toEqual({ reason: "dpgf_import_required", message: expect.stringContaining("import du DPGF"),
      href: `/dashboard/affaires/${PROJECT}#intake` });
    expect(calls.writes).toEqual([]);
  });

  it("finds a remapped DPGF line through the lineage the database kept, and never targets a line on matching metadata alone (fix 5)", async () => {
    // The draft still names M1; the remap replaced it by M2 for the same raw row: only the lineage reader knows M1.
    setUp({ versions: [version(VERSION, 3)], items: [dpgfRow(LINE, MAPPED_OLD)],
      mapped: [{ id: MAPPED_NEW, tenant_id: TENANT, import_id: IMPORT, raw_row_id: RAW, dpgf_imports: { project_id: PROJECT } }],
      lineage: [{ estimate_item_id: LINE, import_id: IMPORT, mapped_row_id: MAPPED_OLD, raw_row_id: RAW }] });
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading(dpgfLavabo) });
    const preview = await previewTakeoffItemSend(JOB, { breakdown: "by_level" });
    expect(preview.lines).toEqual([expect.objectContaining({ target: "dpgf_line", estimate_item_id: LINE, change: "fed", quantity_before: 4,
      quantity_after: 4, reference: 4, measured: 3 })]);
    expect(preview.focus_item_id).toBe(LINE);
    expect(preview.sections).toEqual([]);
    expect(calls.writes).toEqual([]);
    expect(calls.rpcs.every((call) => call.startsWith("service:"))).toBe(true);

    setUp({ versions: [version(VERSION, 3)], items: [dpgfRow(LINE, MAPPED_OLD)], lineage: [] });
    const unproven = await previewTakeoffItemSend(JOB, {});
    expect(unproven.lines).toEqual([]);
    expect(unproven.to_resolve).toEqual([expect.objectContaining({ kind: "target_missing", item_id: DPGF_ITEM })]);
    expect(calls.writes).toEqual([]);
    expect(calls.reads.filter((read) => read.table === "estimate_items").every((read) => !/price|tax|k_fo|k_mo|h_mo|supplier/.test(read.select)))
      .toBe(true);
  });

  it("checks the right to write first: a viewer reads the reason and nothing of the takeoff or of the estimates (fix 12)", async () => {
    setUp({ versions: [version(VERSION, 3)], role: "viewer" });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked?.reason).toBe("read_only");
    expect([preview.plan, preview.list, preview.destinations, preview.lines]).toEqual([null, null, [], []]);
    // The affaire's owner and archive flag are read with the member's session, never the service role's, before the right.
    expect(readTables()).toEqual(["member:estimate_projects", "member:takeoff_jobs"]);
    expect(readItemSendFacts).not.toHaveBeenCalled();
    expect(listActiveTakeoffMappingRules).not.toHaveBeenCalled();
  });

  it("reads the pages held as the writer's page guard reads them, for this job, an entry included (fixes 2 and 3)", async () => {
    // The plan's document and its pages (an entry: every page of the unit) are the database's: the writer's page guard
    // (public.read_takeoff_item_send_draft, the same function the writer reads under its locks).
    setUp({ versions: [version(VERSION, 3)], sources: [{ document_id: PLAN_FILE, logical_document_id: "REF-PLAN-1", kind: "plan" }] });
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading(lavabo, { outcome: "uncertain", decision: null,
      observations: [], entry: { revision: 1, quantity: 2, unit: "u", category: "site_survey", included: true } }) });
    vi.mocked(readItemSendEarlierState).mockResolvedValue({ targets: [], sections: [], displaced: [],
      pagesInEstimate: [{ page: 3, earlierJobIds: ["job-earlier"], estimateItemIds: [LINE], today: true, todayEstimateItemIds: [LINE], parts: [] }] });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(readItemSendEarlierState).toHaveBeenCalledWith(expect.anything(), { projectId: PROJECT, versionId: VERSION, jobId: JOB, incomingCountItems: [] });
    expect(preview.to_resolve).toEqual([expect.objectContaining({ kind: "page_decision", page: 3, held_item_ids: [LAVABO] })]);
    expect(preview.parts_not_sent).toEqual([expect.objectContaining({ item_id: LAVABO, kind: "entered", pages: [1, 2, 3, 4], reason: "page_held" })]);
  });

  it("names the ouvrage a rule points to, by its id and its name in this tenant (fix 14)", async () => {
    setUp({});
    vi.mocked(listActiveTakeoffMappingRules).mockResolvedValue([{ id: "12121212-1212-4212-8212-121212121212", tenant_id: TENANT,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", created_by: MEMBER, name: "Lavabo en ouvrage",
      match_pattern: "lavabo", match_type: "contains", action: "apply_assembly", action_params: { assembly_id: ASSEMBLY }, priority: 1,
      is_active: true } as TakeoffMappingRule]);
    const preview = itemSendPreviewResponseSchema.parse(await previewTakeoffItemSend(JOB, {}));
    expect(preview.rules).toEqual([expect.objectContaining({ effect: "assembly_indicated",
      assembly: { id: ASSEMBLY, name: "Ouvrage lavabo complet" } })]);
    expect(preview.lines).toEqual([expect.objectContaining({ quantity_after: 3 })]);
  });

  it("reads every row of the DPGF lineage: a proof cut at the API's ceiling never chooses a target (closing 3)", async () => {
    const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
    const filler = (index: number) => ({ estimate_item_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, import_id: IMPORT,
      mapped_row_id: MAPPED_NEW, raw_row_id: `raw-${index}` });
    setUp({ versions: [version(VERSION, 3)], items: [dpgfRow(LINE, MAPPED_OLD), dpgfRow(second, MAPPED_OLD)],
      lineage: [{ estimate_item_id: LINE, import_id: IMPORT, mapped_row_id: MAPPED_OLD, raw_row_id: RAW },
        ...Array.from({ length: 999 }, (_, index) => filler(index)),
        { estimate_item_id: second, import_id: IMPORT, mapped_row_id: MAPPED_OLD, raw_row_id: RAW }] });
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading(dpgfLavabo) });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.lines).toEqual([]);
    expect(preview.to_resolve).toEqual([expect.objectContaining({ kind: "target_multiple", item_id: DPGF_ITEM,
      options: [expect.objectContaining({ estimate_item_id: LINE }), expect.objectContaining({ estimate_item_id: second }), { kind: "leave_out" }] })]);
  });

  it("counts only confirmed buildings: a field left to its reading names none (closing 6)", async () => {
    setUp({ locations: [{ id: "loc-1", tenant_id: TENANT, project_id: PROJECT, building_choice: "reading" }] });
    vi.mocked(readTakeoffJobPlanLocations).mockResolvedValue({ plans: [{ plan_file_id: PLAN_FILE, annotation: { revision: 2 },
      location: { building: { value: null, state: "unknown" }, level: { value: "RDC", state: "corrected" } } }] } as never);
    const preview = await previewTakeoffItemSend(JOB, { breakdown: "by_level" });
    expect(preview.lines).toEqual([expect.objectContaining({ compartment: expect.objectContaining({ label: "RDC", reason: null }) })]);
    setUp({ locations: [{ id: "loc-1", tenant_id: TENANT, project_id: PROJECT, building_choice: "value" }] });
    const named = await previewTakeoffItemSend(JOB, { breakdown: "by_level" });
    expect(named.lines).toEqual([expect.objectContaining({ compartment: expect.objectContaining({ key: "unallocated" }) })]);
  });

  it("puts the destination draft's own state in the digest (closing 8)", async () => {
    setUp({ versions: [version(VERSION, 3)] });
    const first = await previewTakeoffItemSend(JOB, {});
    expect(first.plan_digest).toMatch(/^[0-9a-f]{64}$/);
    setUp({ versions: [{ ...version(VERSION, 3), updated_at: "2026-11-22T09:30:00.000Z" }] });
    expect((await previewTakeoffItemSend(JOB, {})).plan_digest).not.toBe(first.plan_digest);
  });

  it("sends a held page's parts once the member decides it, and names a decision the writer would refuse", async () => {
    setUp({ versions: [version(VERSION, 3)] });
    vi.mocked(readItemSendEarlierState).mockResolvedValue({ targets: [], sections: [], displaced: [],
      pagesInEstimate: [{ page: 2, earlierJobIds: ["job-earlier"], estimateItemIds: [LINE], today: true, todayEstimateItemIds: [LINE], parts: [] }] });
    const decided = await previewTakeoffItemSend(JOB, { page_decisions: [{ page: 2, decision: "keep_both", reason_code: "other_zone" }] });
    expect(decided.lines).toEqual([expect.objectContaining({ item_id: LAVABO, quantity_after: 3, pages: [2] })]);
    expect(decided.confirmable).toBe(true);
    const replaced = await previewTakeoffItemSend(JOB, { page_decisions: [{ page: 2, decision: "replace" }] });
    expect(replaced.invalid_page_decisions).toEqual([{ page: 2, reason: "replace_not_cuttable", message: expect.stringContaining("Remplacer") }]);
    expect([replaced.confirmable, replaced.plan_digest]).toEqual([false, null]);
    const unheld = await previewTakeoffItemSend(JOB, { page_decisions: [{ page: 2, decision: "keep_both", reason_code: "other_zone" },
      { page: 4, decision: "replace" }] });
    expect(unheld.invalid_page_decisions).toEqual([expect.objectContaining({ page: 4, reason: "page_not_held" })]);
    expect(calls.writes).toEqual([]);
  });
});

describe("confirmTakeoffItemSend", () => {
  const REQUEST_ID = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";

  it("calls the writer with the server's role, the member as the actor and the server's own first-draft payload", async () => {
    setUp({});
    const preview = await previewTakeoffItemSend(JOB, {});
    const answer = await confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest });
    expect(answer).toEqual(expect.objectContaining({ replayed: false, version_created: true, lines_written: 1, focus_item_id: LINE }));
    expect(calls.rpcs.filter((call) => call.endsWith(`:${WRITER}`))).toEqual([`service:${WRITER}`]);
    expect(written).toEqual([expect.objectContaining({ p_tenant_id: TENANT, p_actor_id: MEMBER, p_module_default: false,
      p_request: expect.objectContaining({ request_id: REQUEST_ID, version_payload: { calc_engine_version: 3, max_section_depth: 3,
        sale_coefficient_fo: 1.3 } }) })]);
    const sent = (written[0].p_request as { plan: { dependencies: { stamps: { mapping: string; first_draft_settings: Row } } } }).plan;
    expect(sent.dependencies.stamps).toEqual(expect.objectContaining({ mapping: "mapping-stamp",
      first_draft_settings: expect.objectContaining({ sale_coefficient_fo: 1.3 }) }));
    expect(calls.writes).toEqual([]);
  });

  it("never lets a member's values reach the writer: no payload, setting, quantity or plan is accepted in the request (point 12)", async () => {
    setUp({});
    const preview = await previewTakeoffItemSend(JOB, {});
    for (const extra of [{ version_payload: { calc_engine_version: 3, sale_coefficient_fo: 9, discount_bp: 5000 } },
      { first_draft_settings: { discount_bp: 5000 } }, { plan: { targets: [] } }, { quantity_after: 99 }, { override: true }]) {
      const error = await confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest, ...extra })
        .then(() => null, (caught: unknown) => caught);
      expect(error).toMatchObject({ status: 422 });
    }
    expect(written).toEqual([]);
  });

  it("never confirms an item under an active « Ignorer » rule: zero estimate writes (point 6)", async () => {
    setUp({});
    vi.mocked(listActiveTakeoffMappingRules).mockResolvedValue([{ id: "13131313-1313-4313-8313-131313131313", tenant_id: TENANT,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", created_by: MEMBER, name: "Ignorer les lavabos",
      match_pattern: "lavabo", match_type: "contains", action: "skip", action_params: {}, priority: 1, is_active: true } as TakeoffMappingRule]);
    const preview = await previewTakeoffItemSend(JOB, {});
    expect([preview.lines, preview.confirmable, preview.plan_digest]).toEqual([[], false, null]);
    expect(preview.not_sent).toEqual([expect.objectContaining({ item_id: LAVABO, reason: "rule_skip" })]);
    const error = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: "a".repeat(64) }));
    // Nothing to send now where a confirmation was asked: a preview to read again (closing of #484), nothing written.
    expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_preview_stale"]);
    expect(written).toEqual([]);
    expect(calls.writes).toEqual([]);
  });

  it("writes only the plan the member saw: another plan computed now is asked again, nothing written", async () => {
    setUp({});
    const error = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: "a".repeat(64) }));
    expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_preview_stale"]);
    expect(written).toEqual([]);
  });

  /** A receipt of this intention key, as committed for the plan the preview showed (its author, its affaire). */
  async function committedReceipt(overrides: Row = {}) {
    setUp({});
    const preview = await previewTakeoffItemSend(JOB, {});
    const state = await computeItemSendState({ ...(await getAuthenticatedTakeoffContext()), tenantRole: "admin" } as never, JOB, {});
    return { preview, receipt: { id: "efefefef-efef-4fef-8fef-efefefefefef", tenant_id: TENANT, request_id: REQUEST_ID,
      command_kind: "send", job_id: JOB, project_id: PROJECT, version_id: VERSION, actor_id: MEMBER,
      write_plan: JSON.parse(JSON.stringify(state.writePlan)), result: { job_id: JOB,
        version_id: VERSION, version_created: true, lines_written: 1, parts_written: 1, parts_replaced: 0, focus_item_id: LINE },
      ...overrides } };
  }

  it("answers a key's receipt for the same plan, and a conflict for another one, without calling the writer", async () => {
    const { preview, receipt } = await committedReceipt();
    setUp({ receipts: [receipt] });
    expect(await confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest }))
      .toEqual(expect.objectContaining({ receipt_id: "efefefef-efef-4fef-8fef-efefefefefef", replayed: true }));
    const error = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: "b".repeat(64) }));
    expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_request_conflict"]);
    expect(written).toEqual([]);
  });

  // Review of #499, round two, point 6: a send committed while its answer was lost is reopened as sent, with the way to
  // what it wrote, whatever intention key the screen holds now.
  it("previews a plan already sent with the way to the line it wrote", async () => {
    const { receipt } = await committedReceipt();
    setUp({ receipts: [receipt], sent: true });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked).toEqual({ reason: "already_sent", message: "Les postes de ce plan ont déjà été envoyés au devis.",
      href: `/dashboard/estimates/${VERSION}/edit?focusItemId=${LINE}` });
    expect(written).toEqual([]);
  });

  // The copy of a draft fed by item (#500) meets the landing of #499: a copy's receipt names no job, so a plan already sent
  // lands on the version its send wrote, never on a copy of it, even one whose receipt would come first.
  it("lands a plan already sent on its send's version, never on a copy's receipt", async () => {
    const { receipt } = await committedReceipt();
    const copyReceipt = { id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", tenant_id: TENANT, request_id: null, command_kind: "copy", job_id: null,
      project_id: PROJECT, version_id: OTHER_VERSION, actor_id: MEMBER, write_plan: {}, created_at: "2026-11-22T00:00:00.000Z",
      result: { version_id: OTHER_VERSION, copied_from_receipt_id: receipt.id, source_job_id: JOB } };
    setUp({ receipts: [copyReceipt, { ...receipt, created_at: "2026-11-22T01:00:00.000Z" }], sent: true });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked).toEqual({ reason: "already_sent", message: "Les postes de ce plan ont déjà été envoyés au devis.",
      href: `/dashboard/estimates/${VERSION}/edit?focusItemId=${LINE}` });
  });

  it("replays only the same choices, of the same author, still allowed to write (closing 9)", async () => {
    const { preview, receipt } = await committedReceipt();
    setUp({ receipts: [receipt] });
    const changed = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest,
      breakdown: "by_level" }));
    expect([changed.status, (changed.details as { guard?: string }).guard]).toEqual([409, "item_send_request_conflict"]);
    setUp({ receipts: [{ ...receipt, actor_id: "22222222-2222-4222-8222-222222222223" }] });
    const another = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest }));
    expect([another.status, (another.details as { guard?: string }).guard]).toEqual([409, "item_send_request_conflict"]);
    setUp({ receipts: [receipt], role: "viewer" });
    const demoted = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest }));
    expect([demoted.status, (demoted.details as { guard?: string }).guard]).toEqual([403, "item_send_project_not_writable"]);
    expect(written).toEqual([]);
  });

  it("answers stale when the only accepted item was set aside after the preview (closing, small)", async () => {
    setUp({});
    const preview = await previewTakeoffItemSend(JOB, {});
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading(lavabo, { decision: { kind: "set_aside", revision: 2 } }) });
    const error = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest }));
    expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_preview_stale"]);
    expect(written).toEqual([]);
  });

  it("answers stale when a line the plan feeds was typed by hand after the preview (follow-up of #484)", async () => {
    const fed: Row = { id: LINE, tenant_id: TENANT, version_id: VERSION, parent_id: null, item_type: "line", position: 1, title: "Lavabo",
      unit_code: "u", pricing_status: "priced", quantity: 3, updated_at: "2026-11-22T08:00:00.000Z", source_provider: "takeoff" };
    setUp({ versions: [version(VERSION, 3)], items: [fed] });
    vi.mocked(readItemSendEarlierState).mockResolvedValue({ targets: [{ itemId: LAVABO, breakdown: "together", compartmentKey: "together",
      estimateItemId: LINE, parts: [{ jobId: "job-earlier", answerId: "answer-earlier", observationIds: ["obs-earlier"], quantity: 3,
        unit: "u", basis: null, qualifiers: {}, pages: [9], planKey: "plan-earlier" }] }], sections: [], displaced: [], pagesInEstimate: [] });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect([preview.confirmable, preview.lines]).toEqual([true, [expect.objectContaining({ estimate_item_id: LINE, quantity_before: 3 })]]);
    // The member types the line's quantity in the editor meanwhile: the confirmation meets a line to settle that the
    // preview did not show, a preview to read again, never a refusal of what the member confirmed.
    Object.assign(fed, { quantity: 7, updated_at: "2026-11-22T09:00:00.000Z" });
    const error = await refusal(confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest }));
    expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_preview_stale"]);
    expect(written).toEqual([]);
  });

  it("never answers a copy's receipt as a send's: its intention key reaches the writer (review of #500, point 3)", async () => {
    // A receipt « copy » (a copy of a draft carried it) under the member's intention key: never the replay of a send.
    setUp({ receipts: [{ id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", tenant_id: TENANT, request_id: REQUEST_ID, command_kind: "copy",
      job_id: JOB, project_id: PROJECT, actor_id: MEMBER, write_plan: {}, result: {} }] });
    const preview = await previewTakeoffItemSend(JOB, {});
    await confirmTakeoffItemSend(JOB, { request_id: REQUEST_ID, plan_digest: preview.plan_digest });
    expect(written).toEqual([expect.objectContaining({ p_request: expect.objectContaining({ request_id: REQUEST_ID }) })]);
  });

  it("gives the member what to do for a refusal of the guard of the applied job, never the generic failure", () => {
    const error = mapItemSendRpcError({ message: "TAKEOFF_APPLY_LOCK_REQUIRED", code: "P0001" }, JOB);
    expect(error.message).not.toContain("a échoué");
    expect(error.message).toMatch(/[a-zàâçéèêëîïôûùüÿœ]/);
  });

  it("names the held count, its reading and mark pages, and both ways to resolve the scope", () => {
    const proof = { job_id: REQUEST_ID, answer_id: null, reading_revision: 3, marks_revision: 8,
      quantity: 2, unit: "u", pages: [2, 7] };
    const error = mapItemSendRpcError({ message: "TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE", code: "40001",
      details: JSON.stringify({ ...proof, reason: "verified_total_indivisible" }) }, JOB);
    expect(error).toMatchObject({ status: 409, code: "TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE",
      details: { verified_total: proof } });
    expect(error.message).toContain("Le devis conserve le comptage de 2 u, issu de la lecture n° 3 (repères pages 2, 7)");
    expect(error.message).toContain("une lecture qui couvre tout le plan");
    expect(error.message).toContain("conserver le total précédent");
    expect(error.message).toContain("Rien n’a été écrit.");
  });

  it.each([["entered", "la saisie"], ["measured", "la mesure"]])("names the earlier %s part held by the writer", (source, label) => {
    const held = { source, job_id: REQUEST_ID, answer_id: null, reading_revision: 3, quantity: 7.5, unit: "u", pages: [2] };
    const error = mapItemSendRpcError({ message: "TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE", code: "40001",
      details: JSON.stringify({ job_id: JOB, answer_id: null, reading_revision: 4, marks_revision: 1, quantity: 1,
        unit: "u", pages: [7], held_part: held }) }, JOB);
    expect(error.details).toMatchObject({ held_part: held });
    expect(error.message).toContain(`Le devis conserve ${label} de 7,5 u de la lecture n° 3 (page 2)`);
    expect(error.message).toContain("une lecture qui couvre tout le plan");
    expect(error.message).toContain("conserver le total précédent");
  });

  it("tells the member, in French, every refusal of the writer; nothing was written", () => {
    const cases: Array<[string, string | null, string | null, number]> = [
      ["TAKEOFF_ITEM_SEND_PREVIEW_STALE", "40001", '{"reason": "mapping_changed"}', 409],
      ["TAKEOFF_ITEM_SEND_PREVIEW_STALE", "40001", '{"reason": "dpgf_changed"}', 409],
      ["TAKEOFF_ITEM_SEND_PREVIEW_STALE", "40001", '{"reason": "creation_policy_changed"}', 409],
      ["ESTIMATE_CALC_POLICY_CONTEXT_CHANGED", "40001", null, 409],
      ["TAKEOFF_ITEM_SEND_REQUEST_CONFLICT", "40001", null, 409],
      ["TAKEOFF_ITEM_SEND_ALREADY_SENT", "40001", null, 409],
      ["TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE", "42501", null, 403],
      ["TAKEOFF_ITEM_SEND_MODULE_DISABLED", "55000", null, 403],
      ["TAKEOFF_ITEM_SEND_DRAFT_LOCKED", "55P03", null, 409],
      ["TAKEOFF_ITEM_SEND_DRAFT_LOCK_REQUIRED", "55P03", null, 409],
      ["TAKEOFF_ITEM_SEND_COPY_UNREAD", "22023", null, 422],
      ["TAKEOFF_ITEM_SEND_DPGF_IMPORT_REQUIRED", "22023", null, 422],
      ["TAKEOFF_ITEM_SEND_PAGE_DECISION_REQUIRED", "22023", '{"reason": "page_held"}', 422],
      ["TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID", "22023", '{"reason": "keep_both_same_line", "page": 2}', 422],
      ["TAKEOFF_ITEM_SEND_QUANTITY_UNWRITABLE", "22023", null, 422],
      ["TAKEOFF_ITEM_SEND_ENGINE_NOT_V3", "22023", null, 422],
      ["TAKEOFF_ITEM_SEND_NOT_ITEM_LIST", "22023", null, 409],
      ["TAKEOFF_ITEM_SEND_JOB_NOT_READY", "40001", null, 409],
      ["TAKEOFF_ITEM_SEND_INVALID", "22023", null, 500],
    ];
    for (const [message, code, details, status] of cases) {
      const error = mapItemSendRpcError({ message, code: code ?? undefined, details: details ?? undefined }, JOB);
      expect([message, error.status]).toEqual([message, status]);
      expect(error.message).toMatch(/[a-zàâçéèêëîïôûùüÿœ]/);
      expect(error.message).not.toContain("TAKEOFF_");
    }
    expect(mapItemSendRpcError({ message: "TAKEOFF_ITEM_SEND_PREVIEW_STALE", code: "40001",
      details: '{"reason":"measure_reconciliation_changed"}' }, JOB).message).toBe(
      "Le métré, le devis ou la liste ont changé depuis l’aperçu. Rouvrez l’aperçu puis confirmez de nouveau. Rien n’a été écrit.");
    expect(mapItemSendRpcError({ message: "TAKEOFF_ITEM_SEND_PAGE_DECISION_INVALID", code: "22023",
      details: '{"reason": "keep_both_same_line", "page": 2}' }, JOB).message).toContain("Garder les deux");
  });
});
