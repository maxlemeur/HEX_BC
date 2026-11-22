import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./feature-flags", () => ({ getTakeoffLowConfidenceThresholdForTenant: vi.fn(async () => 0.5) }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { freezeAffaireItemSelection, readAffaireItemHistory, readAffaireItemLine, readAffaireItemTable } from "./item-table-server";
import { ITEM_REVIEW_LIMITS } from "./item-table";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TENANT = "77777777-7777-4777-8777-777777777777";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const PLAN = "55555555-5555-4555-8555-555555555555";
const itemId = (index: number) => `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`;
const rowId = (index: number) => `00000000-0000-4000-c000-${String(index).padStart(12, "0")}`;

/** An answer as private.takeoff_item_answer_document gives it. */
function answer(index: number, outcome: "measured" | "not_found") {
  return {
    answer_id: `00000000-0000-4000-b000-${String(index).padStart(12, "0")}`, job_id: "33333333-3333-4333-8333-333333333333",
    item_id: itemId(index), list_revision_id: "44444444-4444-4444-8444-444444444444", plan_file_id: PLAN, plan_logical_id: PLAN,
    plan_generation: null, outcome, quantity: outcome === "measured" ? 3 : null, unit: outcome === "measured" ? "u" : null,
    candidate_quantity: null, candidate_unit: null, searched_pages: [1], unreadable_pages: [],
    reasons: outcome === "measured" ? [] : [{ code: "NO_INDICATION", by: "model", text: "Aucun indice.", chunk_id: null }],
    reason_code: outcome === "measured" ? null : "NO_INDICATION", reason_text: outcome === "measured" ? null : "Aucun indice.",
    revision: "a".repeat(64), reading_revision: 1, replaces_answer_id: null, published_at: "2026-11-22T09:00:00Z",
    observations: outcome === "measured" ? [{ observation_id: `00000000-0000-4000-d000-${String(index).padStart(12, "0")}`,
      ordinal: 1, role: "contribution", source: "model", page: 1, quantity: 3, unit: "u", measurement_basis: null,
      evidence: "Symboles fictifs", confidence: 0.9, method: "symbol_count", chunk_id: null, vector_item_id: null,
      takeoff_item_id: rowId(index), occurrence_coverage: "page_total" }] : [],
  };
}

/** A row of public.read_takeoff_item_table. */
function tableRow(index: number, extra: Record<string, unknown> = {}) {
  return {
    item_id: itemId(index), item_position: index, label: `Poste ${index}`, expected_unit: "u",
    sections: [{ id: "s", title: "Plomberie", order: 1 }], reference_quantity: null, origin_kind: "template", dpgf_reference: null,
    family: "Plomberie", state: "measured", expected: 1, answered: 1, in_flight: 0, ended: 0, decision: "pending",
    matching_items: 2, page_offset: 0, focus_found: false, entry: null,
    readings: [{ plan_logical_id: PLAN, plan_file_id: PLAN, plan_name: "Plan RDC", plan_generation: null, location_key: "A|RDC",
      location_label: "A · RDC", job_id: "33333333-3333-4333-8333-333333333333", unit_state: "succeeded", reading: "answered",
      answer: answer(index, index === 0 ? "measured" : "not_found"), decision: null, decision_revision: 0, entry: null }],
    ...extra,
  };
}

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const reads: string[] = [];
let tableRows: Array<Record<string, unknown>> = [];
let takeoffRows: Array<Record<string, unknown>> = [];
let events: Array<Record<string, unknown>> = [];
const ranges: Array<[number, number]> = [];

function memberClient() {
  const from = (table: string) => {
    reads.push(table);
    const data = table === "takeoff_items" ? takeoffRows
      : table === "takeoff_list_revisions" ? [{ id: "44444444-4444-4444-8444-444444444444", revision: 2, item_count: 2 }]
        : table === "takeoff_item_review_events" ? events
          : table === "profiles" ? [{ id: MEMBER, full_name: " Léa Martin " }] : (() => { throw new Error(`Unexpected read of ${table}.`); })();
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit"]) builder[method] = () => builder;
    builder.range = (from: number, to: number) => {
      ranges.push([from, to]);
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return builder;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "read_takeoff_item_table") {
      const offset = Number(args.p_offset ?? 0);
      return Promise.resolve({ data: offset > 0 && tableRows.length && tableRows[0].page_offset === 0 ? [] : tableRows, error: null });
    }
    if (name === "count_takeoff_item_table") {
      return Promise.resolve({ data: [{ facet: "state", value: "measured", label: null, items: 1 },
        { facet: "plan", value: PLAN, label: "Plan RDC", items: 2 }, { facet: "family", value: "Plomberie", label: null, items: 2 },
        { facet: "location", value: "A|RDC", label: "A · RDC", items: 2 }], error: null });
    }
    throw new Error(`Unexpected call of ${name}.`);
  };
  return { from, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  reads.length = 0;
  ranges.length = 0;
  events = [];
  tableRows = [tableRow(0), tableRow(1)];
  takeoffRows = [{ id: rowId(0), quantity: 3, unit: "u", is_verified: false, is_excluded: false, rules_stale: false, rule_results: [], confidence: 0.4, evidence: "Symboles",
    source_page: 1, metadata: {}, quantity_entry_category: null }];
  vi.mocked(requireAffaireAccess).mockResolvedValue({ context: { tenantId: TENANT, userId: MEMBER, supabase: memberClient() },
    project: { id: PROJECT } } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc: vi.fn(async () => ({ data: true, error: null })) } as never);
});

const query = { scope: { kind: "plan" as const, planKey: PLAN }, filter: { states: ["measured" as const], families: ["Plomberie"],
  locations: ["A|RDC"], decisions: ["pending" as const] }, offset: 0, limit: 50, focusItemId: itemId(1) };

describe("readAffaireItemTable", () => {
  it("asks the database for the page in the scope, filtered and focused, and its facets: nothing is filtered here", async () => {
    await readAffaireItemTable(PROJECT, query);
    expect(calls.find(({ name }) => name === "read_takeoff_item_table")?.args).toEqual({ p_tenant_id: TENANT, p_project_id: PROJECT,
      p_plan_logical_id: PLAN, p_states: ["measured"], p_families: ["Plomberie"], p_locations: ["A|RDC"], p_decisions: ["pending"],
      p_focus_item_id: itemId(1), p_offset: 0, p_limit: 50 });
    expect(calls.find(({ name }) => name === "count_takeoff_item_table")?.args).toEqual({ p_tenant_id: TENANT, p_project_id: PROJECT,
      p_plan_logical_id: PLAN });
  });

  it("keeps the database's state and decision, and finds the anomalies of the positive rows read for the page", async () => {
    const table = await readAffaireItemTable(PROJECT, { ...query, scope: { kind: "affaire" }, filter: {}, focusItemId: null });
    expect(table.page.lines.map(({ state, decision }) => [state, decision])).toEqual([["measured", "pending"], ["measured", "pending"]]);
    // Row 0's confidence is below the tenant's threshold: its answer is not accepted in bulk.
    expect(table.page.lines[0].readings[0].answer?.anomalies).toEqual(["low_confidence"]);
    expect(table.page.lines[0].eligibility.accept_measured).toEqual({ eligible: false, reason: "anomaly" });
    expect(table.page.lines[0].readings[0]).toMatchObject({ planKey: PLAN, planName: "Plan RDC", location: "A · RDC" });
    expect(table.facets).toMatchObject({ states: { measured: 1 }, families: [{ value: "Plomberie", count: 2 }],
      locations: [{ value: "A|RDC", label: "A · RDC", count: 2 }], plans: [{ key: PLAN, name: "Plan RDC", count: 2 }] });
    expect(table.page).toMatchObject({ total: 2, offset: 0, limit: 50, focusFound: false });
    expect(table.canReview).toBe(true);
  });

  it("reads a bounded number of statements for a page, whatever the length of the list", async () => {
    await readAffaireItemTable(PROJECT, { ...query, scope: { kind: "affaire" }, filter: {}, focusItemId: null });
    expect(calls.map(({ name }) => name).sort()).toEqual(["count_takeoff_item_table", "read_takeoff_item_table"]);
    expect(reads.sort()).toEqual(["takeoff_items", "takeoff_list_revisions"]);
  });

  it("reads the first page when the address names a page past the end", async () => {
    tableRows = [tableRow(0, { page_offset: 0 })];
    const table = await readAffaireItemTable(PROJECT, { ...query, scope: { kind: "affaire" }, filter: {}, focusItemId: null, offset: 100 });
    expect(calls.filter(({ name }) => name === "read_takeoff_item_table").map(({ args }) => args.p_offset)).toEqual([100, 0]);
    expect(table.page.lines).toHaveLength(1);
  });
});

describe("one item on its own", () => {
  it("reads it outside any filter, and answers null when the list does not hold it", async () => {
    tableRows = [tableRow(1)];
    expect((await readAffaireItemLine(PROJECT, itemId(1)))?.line.itemId).toBe(itemId(1));
    expect(calls.find(({ name }) => name === "read_takeoff_item_table")?.args).toMatchObject({ p_item_ids: [itemId(1)] });
    tableRows = [];
    expect(await readAffaireItemLine(PROJECT, itemId(9))).toBeNull();
  });
});

describe("freezeAffaireItemSelection", () => {
  it("refuses a selection above its bound, never cuts it", async () => {
    tableRows = Array.from({ length: ITEM_REVIEW_LIMITS.items + 1 }, (_, index) => tableRow(index));
    await expect(freezeAffaireItemSelection(PROJECT, { scope: { kind: "affaire" }, selection: { kind: "filter", filter: {} } }))
      .rejects.toMatchObject({ status: 422, code: "TAKEOFF_ITEM_SELECTION_TOO_LARGE" });
  });

  it("refuses 1 001 matching items from the count the database gives, before building anything", async () => {
    // The Data API gives 1 000 rows at most: the 1 001st is only in the count.
    tableRows = Array.from({ length: ITEM_REVIEW_LIMITS.items }, (_, index) => tableRow(index, { matching_items: ITEM_REVIEW_LIMITS.items + 1 }));
    await expect(freezeAffaireItemSelection(PROJECT, { scope: { kind: "affaire" }, selection: { kind: "filter", filter: {} } }))
      .rejects.toMatchObject({ status: 422, code: "TAKEOFF_ITEM_SELECTION_TOO_LARGE" });
    expect(reads).not.toContain("takeoff_items");
  });

  it("freezes the items named, and names those no longer in the list", async () => {
    tableRows = [tableRow(1)];
    const frozen = await freezeAffaireItemSelection(PROJECT, { scope: { kind: "affaire" },
      selection: { kind: "items", itemIds: [itemId(1), itemId(9)] } });
    expect(frozen).toMatchObject({ count: 1, missing: [itemId(9)], items: [{ itemId: itemId(1), label: "Poste 1" }] });
    expect(calls.find(({ name }) => name === "read_takeoff_item_table")?.args).toMatchObject({ p_item_ids: [itemId(1), itemId(9)],
      p_limit: ITEM_REVIEW_LIMITS.items + 1 });
  });
});

describe("the history of a line", () => {
  it("reads its journal by pages, newest first, with the authors' names", async () => {
    events = Array.from({ length: 21 }, (_, index) => ({ id: 100 - index, event: index % 2 ? "set_aside" : "reinstated",
      plan_logical_id: PLAN, takeoff_item_id: null, before: { kind: "set_aside" }, after: { kind: "none" }, actor_id: MEMBER,
      at: "2026-11-22T09:00:00Z" }));
    const page = await readAffaireItemHistory(PROJECT, itemId(1), { offset: 20, limit: 20 });
    expect(ranges).toEqual([[20, 40]]);
    expect(page).toMatchObject({ itemId: itemId(1), offset: 20, limit: 20, hasMore: true, names: { [MEMBER]: "Léa Martin" } });
    expect(page.events).toHaveLength(20);
    expect(page.events[0]).toMatchObject({ id: 100, event: "reinstated", planKey: PLAN, actorId: MEMBER });
  });
});
