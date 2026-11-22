import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/takeoff/job-read-server", () => ({ getAuthenticatedTakeoffContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/item-send-facts-server", () => ({ readItemSendFacts: vi.fn(), readItemSendEarlierState: vi.fn() }));
vi.mock("@/lib/takeoff/mapping-rules-server", () => ({ listActiveTakeoffMappingRules: vi.fn() }));
vi.mock("@/lib/takeoff/plan-location-server", () => ({ readTakeoffJobPlanLocations: vi.fn() }));
vi.mock("@/lib/takeoff/page-contributions-server", () => ({ readPlanPagesAlreadyInEstimate: vi.fn() }));
vi.mock("@/lib/estimates/calc-policy-server", () => ({ readTenantCalcPolicy: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-repository", () => ({ readDpgfMappedFacts: vi.fn() }));

import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readDpgfMappedFacts } from "@/lib/takeoff/dpgf-comparison-repository";
import { TakeoffError } from "@/lib/takeoff/errors";
import { itemSendPreviewResponseSchema } from "@/lib/takeoff/item-send-contracts";
import { readItemSendEarlierState, readItemSendFacts, type ItemSendReading } from "@/lib/takeoff/item-send-facts-server";
import { previewTakeoffItemSend } from "@/lib/takeoff/item-send-preview-server";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { listActiveTakeoffMappingRules } from "@/lib/takeoff/mapping-rules-server";
import { readPlanPagesAlreadyInEstimate } from "@/lib/takeoff/page-contributions-server";
import { readTakeoffJobPlanLocations } from "@/lib/takeoff/plan-location-server";

// Lot 4, PR 5a: the read-only preview of a send by item, written before it existed. Every client refuses any write and any
// RPC: the preview reads, computes and writes nothing. Fictional affaire, plan and quantities.

const TENANT = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const REVISION = "66666666-6666-4666-8666-666666666666";
const VERSION = "77777777-7777-4777-8777-777777777777";
const PLAN_FILE = "88888888-8888-4888-8888-888888888888";
const LAVABO = "99999999-9999-4999-8999-999999999991";
const DPGF_ITEM = "99999999-9999-4999-8999-999999999992";
const ANSWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

type Row = Record<string, unknown>;
type Writes = Array<{ client: string; call: string; table?: string }>;

/** A client over in-memory tables: reads filter by equality and membership, every write and every RPC is refused. */
function fakeClient(name: string, tables: Record<string, Row[]>, writes: Writes) {
  const refuse = (call: string, table?: string) => {
    writes.push({ client: name, call, table });
    throw new Error(`${name}: ${call} refusé dans un aperçu`);
  };
  return {
    rpc: (fn: string) => refuse(`rpc:${fn}`),
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let slice: [number, number] | null = null;
      let limit: number | null = null;
      const result = () => {
        const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        const shown = slice ? rows.slice(slice[0], slice[1] + 1) : limit !== null ? rows.slice(0, limit) : rows;
        return { data: shown, error: null, count: rows.length };
      };
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { if (!column.includes(".")) filters.push((row) => row[column] === value); return builder; },
        in: (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; },
        is: () => builder,
        not: () => builder,
        neq: () => builder,
        order: () => builder,
        limit: (count: number) => { limit = count; return builder; },
        range: (from: number, to: number) => { slice = [from, to]; return builder; },
        maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
        insert: () => refuse("insert", table),
        update: () => refuse("update", table),
        upsert: () => refuse("upsert", table),
        delete: () => refuse("delete", table),
      };
      return builder;
    },
  };
}

const lavabo = { id: LAVABO, label: "Lavabo", expectedUnit: "u", measurementBasis: null, qualifiers: {},
  sections: [{ id: "lot", title: "Plomberie", order: 1 }, { id: "sanitaires", title: "Appareils sanitaires", order: 2 }],
  referenceQuantity: null, origin: { kind: "template" as const, templateId: "plomberie", version: 1, familyId: "sanitaires", lineId: "lavabo" } };
const dpgfLavabo = { ...lavabo, id: DPGF_ITEM, sections: [{ id: "lot", title: "Plomberie", order: 1 }], referenceQuantity: 4,
  origin: { kind: "dpgf" as const, importId: "import-1", mappingId: "mapping-1", rawRowId: "raw-1", mappedRowId: "mapped-1", rowIndex: 3,
    sheetName: null, sourceRowNumber: 3, sourcePage: null, tableIndex: null, documentId: null, reference: "1.2", sourceUnit: "u",
    measurementNotesDigest: null, factsDigest: "facts" } };

function reading(item: typeof lavabo | typeof dpgfLavabo = lavabo): ItemSendReading {
  return { items: [item], scope: [item.id], affaireEntries: [], answers: [{ itemId: item.id, answerId: ANSWER, revision: "r1",
    outcome: "measured", anomalies: [], decision: null, entry: null,
    observations: [{ observationId: "obs-1", role: "contribution", source: "model", quantity: 3, unit: "u", page: 2, measurementBasis: null }] }] };
}

function manifest(order: "item_list" | "free_extraction", format: 1 | 2 = 2) {
  return { format_version: format, intent: "initial",
    order: order === "item_list" ? { kind: "item_list", version: 2, list: { revision_id: REVISION, revision: 3, content_sha256: "c".repeat(64),
      item_count: 1 } } : { kind: "free_extraction", version: 1, list: null },
    units: [{ key: "unit-1", ordinal: 1, plans: [PLAN_FILE], pages: [], page_count: 4, budget: { tokens: 1, cost_cents: 1 }, vector_pages: 0 }],
    plans: [{ entry_key: PLAN_FILE, name: "Plan RDC", logical_id: "piece-1", intake_document_id: null, plan_file_id: PLAN_FILE, generation: "1",
      content_sha256: "d".repeat(64), pages: [], page_count: 4 }] };
}

let writes: Writes;
function setUp(input: { manifest: unknown; versions?: Row[]; items?: Row[]; role?: string }) {
  writes = [];
  const shared = {
    takeoff_launch_requests: [{ id: REQUEST, tenant_id: TENANT, manifest: input.manifest }],
    estimate_projects: [{ id: PROJECT, tenant_id: TENANT, user_id: MEMBER, is_archived: false }],
    estimate_versions: input.versions ?? [],
    estimate_items: input.items ?? [],
  };
  const member = fakeClient("member", { ...shared, takeoff_jobs: [{ id: JOB, tenant_id: TENANT, project_id: PROJECT, estimate_version_id: null,
    status: "completed", launch_request_id: REQUEST, launch_unit_key: "unit-1" }], dpgf_rows_mapped: [] }, writes);
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: member, tenantId: TENANT, userId: MEMBER,
    tenantRole: input.role ?? "admin" } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(fakeClient("service", shared, writes) as never);
}

const draftVersion = (engine: number) => ({ id: VERSION, tenant_id: TENANT, project_id: PROJECT, version_number: 1, status: "draft", title: null,
  variant_label: null, updated_at: "2026-11-22T08:00:00.000Z", calc_engine_version: engine, max_section_depth: 3 });

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(TakeoffError);
  return error as TakeoffError;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading() });
  vi.mocked(readItemSendEarlierState).mockResolvedValue({ targets: [], sections: [] });
  vi.mocked(listActiveTakeoffMappingRules).mockResolvedValue([]);
  vi.mocked(readPlanPagesAlreadyInEstimate).mockResolvedValue([]);
  vi.mocked(readTenantCalcPolicy).mockResolvedValue({ engine: 3, defaultSaleCoefficientFo: null, defaultSaleCoefficientMo: null,
    allowedTaxRatesBp: [2000] } as never);
  vi.mocked(readDpgfMappedFacts).mockResolvedValue(new Map());
  vi.mocked(readTakeoffJobPlanLocations).mockResolvedValue({ plans: [] } as never);
});

describe("previewTakeoffItemSend", () => {
  it("refuses a takeoff not read against the list: today's send stays the way to send it", async () => {
    for (const sealed of [manifest("free_extraction"), manifest("item_list", 1)]) {
      setUp({ manifest: sealed });
      const error = await refusal(previewTakeoffItemSend(JOB, {}));
      expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_not_item_list"]);
    }
    expect(readItemSendFacts).not.toHaveBeenCalled();
  });

  it("says the answers are not stored yet, and writes nothing", async () => {
    setUp({ manifest: manifest("item_list") });
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "not_stored" });
    const error = await refusal(previewTakeoffItemSend(JOB, {}));
    expect([error.status, (error.details as { guard?: string }).guard]).toEqual([409, "item_send_answers_not_stored"]);
    expect(writes).toEqual([]);
  });

  it("previews the first draft it would create, its sections and lines, and writes nothing", async () => {
    setUp({ manifest: manifest("item_list") });
    const preview = itemSendPreviewResponseSchema.parse(await previewTakeoffItemSend(JOB, {}));
    expect(preview).toEqual(expect.objectContaining({ version_created: true, destination: { kind: "first_draft" }, engine: 3, blocked: null,
      confirmable: true, breakdown: "together" }));
    expect(preview.sections.map((section) => section.title)).toEqual(["Plomberie", "Appareils sanitaires"]);
    expect(preview.lines).toEqual([expect.objectContaining({ item_id: LAVABO, change: "created", quantity_before: null, quantity_after: 3,
      pages: [2] })]);
    expect(preview.plan_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(readItemSendFacts).toHaveBeenCalledWith(expect.anything(), { jobId: JOB, projectId: PROJECT,
      list: { revisionId: REVISION, revision: 3, itemCount: 1 } });
    expect(writes).toEqual([]);
  });

  it("checks engine 3 at the preview and names the reason, reading no plan location for « Ensemble »", async () => {
    setUp({ manifest: manifest("item_list"), versions: [draftVersion(2)] });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked).toEqual(expect.objectContaining({ reason: "engine_not_v3" }));
    expect(preview.blocked!.message).toContain("moteur 3");
    expect(preview.lines).toEqual([]);
    expect(readTakeoffJobPlanLocations).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("points to the confirmed import of the DPGF for a draft without its lines, and imports nothing", async () => {
    setUp({ manifest: manifest("item_list"), versions: [draftVersion(3)] });
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading(dpgfLavabo) });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked).toEqual({ reason: "dpgf_import_required", message: expect.stringContaining("import du DPGF"),
      href: `/dashboard/affaires/${PROJECT}#intake` });
    expect(writes).toEqual([]);
  });

  it("feeds the DPGF line of the draft where it is and opens the editor on it", async () => {
    setUp({ manifest: manifest("item_list"), versions: [draftVersion(3)], items: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", tenant_id: TENANT,
      version_id: VERSION, parent_id: null, item_type: "line", position: 1, title: "Lavabo", unit_code: "u", pricing_status: "priced", quantity: 4,
      updated_at: "2026-11-22T08:00:00.000Z", source_provider: "dpgf", mapped_row_id: "mapped-1", import_id: "import-1",
      dpgf_source_quantity: 4, quantity_policy: null }] });
    vi.mocked(readItemSendFacts).mockResolvedValue({ state: "stored", reading: reading(dpgfLavabo) });
    const preview = await previewTakeoffItemSend(JOB, { breakdown: "by_level" });
    expect(preview.lines).toEqual([expect.objectContaining({ target: "dpgf_line", change: "fed", quantity_before: 4, quantity_after: 4,
      reference: 4, measured: 3 })]);
    expect(preview.focus_item_id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1");
    expect(preview.sections).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("reads nothing of the estimates for a member who cannot write the affaire", async () => {
    setUp({ manifest: manifest("item_list"), versions: [draftVersion(3)], role: "viewer" });
    const preview = await previewTakeoffItemSend(JOB, {});
    expect(preview.blocked?.reason).toBe("read_only");
    expect(preview.destinations).toEqual([]);
    expect(listActiveTakeoffMappingRules).not.toHaveBeenCalled();
  });
});
