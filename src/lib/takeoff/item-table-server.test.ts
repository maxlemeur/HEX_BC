import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./item-remeasure-server", () => ({ readFirstMeasurePlans: vi.fn() }));
vi.mock("./feature-flags", () => ({ getTakeoffLowConfidenceThresholdForTenant: vi.fn(async () => 0.5) }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { freezeAffaireItemSelection, readAffaireItemHistory, readAffaireItemLine, readAffaireItemTable } from "./item-table-server";
import { readFirstMeasurePlans } from "./item-remeasure-server";
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
let jobRows: Array<Record<string, unknown>> = [];
/** The answers' counted marks states (lot 5), as a member reads them. */
let marksStates: Array<{ answer_id: string; revision: number }> = [];
const ranges: Array<[number, number]> = [];

function memberClient() {
  const from = (table: string) => {
    reads.push(table);
    const data = table === "takeoff_items" ? takeoffRows
      : table === "takeoff_list_revisions" ? [{ id: "44444444-4444-4444-8444-444444444444", revision: 2, item_count: 2 }]
        : table === "takeoff_item_review_events" ? events
          : table === "takeoff_jobs" ? jobRows
          : table === "takeoff_item_entries" || table === "takeoff_item_answer_decisions" ? []
          : table === "takeoff_count_answer_states" ? marksStates
          : table === "profiles" ? [{ id: MEMBER, full_name: " Léa Martin " }] : (() => { throw new Error(`Unexpected read of ${table}.`); })();
    const builder: Record<string, unknown> = {};
    // The journal is read as PostgREST reads it: its filters, its order and its range (both ends included).
    const filters: Array<[string, unknown]> = [];
    let order: { column: string; ascending: boolean } | null = null;
    let range: [number, number] | null = null;
    for (const method of ["select", "in", "limit", "is"]) builder[method] = () => builder;
    builder.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    };
    builder.order = (column: string, options?: { ascending?: boolean }) => {
      order = { column, ascending: options?.ascending ?? true };
      return builder;
    };
    builder.range = (from: number, to: number) => {
      ranges.push([from, to]);
      range = [from, to];
      return builder;
    };
    const result = () => {
      if (table !== "takeoff_item_review_events") return data;
      const sorted = data.filter((row) => filters.every(([column, value]) => row[column] === value));
      const by = order;
      if (by) {
        sorted.sort((left, right) => (Number(left[by.column]) - Number(right[by.column])) * (by.ascending ? 1 : -1));
      }
      return range ? sorted.slice(range[0], range[1] + 1) : sorted;
    };
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve);
    return builder;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "read_takeoff_count_mark_summaries") return Promise.resolve({ data: [], error: null });
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
  jobRows = [];
  marksStates = [];
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
  it("returns the confirmed plans on both detail reads after a failed attempt with no answer", async () => {
    const failed = { ...tableRow(0).readings[0], unit_state: "failed", reading: "ended", answer: null };
    tableRows = [tableRow(0, { state: "to_measure", answered: 0, ended: 1, decision: "none", readings: [failed] })];
    const confirmed = [PLAN, itemId(5)].map((key, i) => ({ key, name: i ? "Étage" : "RDC", location: null }));
    vi.mocked(readFirstMeasurePlans).mockResolvedValue(confirmed);
    const page = await readAffaireItemTable(PROJECT, { ...query, scope: { kind: "affaire" }, filter: {} }, true);
    const single = await readAffaireItemLine(PROJECT, itemId(0), true);
    expect([page.plans, single?.plans]).toEqual([confirmed, confirmed]);
  });

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
    expect(reads.sort()).toEqual(["takeoff_count_answer_states", "takeoff_items", "takeoff_list_revisions"]);
  });

  it("reads the first page when the address names a page past the end", async () => {
    tableRows = [tableRow(0, { page_offset: 0 })];
    const table = await readAffaireItemTable(PROJECT, { ...query, scope: { kind: "affaire" }, filter: {}, focusItemId: null, offset: 100 });
    expect(calls.filter(({ name }) => name === "read_takeoff_item_table").map(({ args }) => args.p_offset)).toEqual([100, 0]);
    expect(table.page.lines).toHaveLength(1);
  });
});

describe("a new measure of a plan after its answer", () => {
  // The pair's latest job asked is a later one than its answer's: a new measure of the item on that plan.
  const LATER = "66666666-6666-4666-8666-666666666666";
  const laterReading = (index: number, unit: string) => tableRow(index, { readings: [{ ...tableRow(index).readings[0], job_id: LATER,
    unit_state: unit, reading: "answered" }] });

  it("shows the earlier answer, and that the new measure did not end, with its reason in French", async () => {
    tableRows = [laterReading(1, "failed")];
    jobRows = [{ id: LATER, error_code: "AI_PROVIDER" }];
    const line = (await readAffaireItemLine(PROJECT, itemId(1)))!.line;
    expect(line.readings[0].answer?.outcome).toBe("not_found");
    expect(line.readings[0].attempt).toEqual({ unit: "failed", reason: "Le service d’analyse n’a pas pu terminer le métré." });
    expect(reads).toContain("takeoff_jobs");
  });

  it("gives a reason of its own words, never an internal code, for a failure the screen does not name", async () => {
    tableRows = [laterReading(1, "failed")];
    jobRows = [{ id: LATER, error_code: "TAKEOFF_SOMETHING_INTERNAL" }];
    expect((await readAffaireItemLine(PROJECT, itemId(1)))!.line.readings[0].attempt)
      .toEqual({ unit: "failed", reason: "L’analyse a été interrompue pour une raison non répertoriée." });
  });

  it("says a new measure still runs, and reads no job for it; none when the answer is the latest reading", async () => {
    tableRows = [laterReading(1, "running")];
    expect((await readAffaireItemLine(PROJECT, itemId(1)))!.line.readings[0].attempt).toEqual({ unit: "running", reason: null });
    tableRows = [tableRow(1)];
    expect((await readAffaireItemLine(PROJECT, itemId(1)))!.line.readings[0].attempt).toBeNull();
    expect(reads).not.toContain("takeoff_jobs");
  });
});

describe("one item on its own", () => {
  it("reads it outside any filter, and answers null when the list does not hold it", async () => {
    tableRows = [tableRow(1)];
    const released = await readAffaireItemLine(PROJECT, itemId(1));
    expect(released?.line.itemId).toBe(itemId(1));
    expect(released).not.toHaveProperty("listRevisionId");
    expect(await readAffaireItemLine(PROJECT, itemId(1), true)).toHaveProperty("listRevisionId");
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
    // Lot 5: the answer's counted marks are at revision 3; the selection carries it, for an acceptance to compare.
    marksStates = [{ answer_id: "00000000-0000-4000-b000-000000000001", revision: 3 }];
    const frozen = await freezeAffaireItemSelection(PROJECT, { scope: { kind: "affaire" },
      selection: { kind: "items", itemIds: [itemId(1), itemId(9)] } });
    expect(frozen).toMatchObject({ count: 1, missing: [itemId(9)], items: [{ itemId: itemId(1), label: "Poste 1" }] });
    expect(frozen.items[0]!.target.answers).toEqual([expect.objectContaining({ answerId: "00000000-0000-4000-b000-000000000001",
      marksRevision: 3 })]);
    expect(calls.find(({ name }) => name === "read_takeoff_item_table")?.args).toMatchObject({ p_item_ids: [itemId(1), itemId(9)],
      p_limit: ITEM_REVIEW_LIMITS.items + 1 });
  });
});

describe("the history of a line", () => {
  it("reads its journal by pages, newest first, only the line's, with the authors' names", async () => {
    const event = (id: number, extra: Record<string, unknown> = {}) => ({ id, tenant_id: TENANT, project_id: PROJECT, item_id: itemId(1),
      event: id % 2 ? "set_aside" : "reinstated", plan_logical_id: PLAN, takeoff_item_id: null, before: { kind: "set_aside" },
      after: { kind: "none" }, actor_id: MEMBER, at: "2026-11-22T09:00:00Z", ...extra });
    // 21 events of the line, stored out of order, and newer ones of another line, another affaire and another tenant.
    const own = [7, 21, 3, 14, 1, 18, 10, 5, 20, 12, 16, 2, 9, 19, 4, 11, 15, 6, 17, 8, 13].map((id) => event(id));
    events = [event(40, { item_id: itemId(2) }), ...own.slice(0, 10), event(41, { project_id: "99999999-9999-4999-8999-999999999999" }),
      ...own.slice(10), event(42, { tenant_id: "88888888-8888-4888-8888-888888888888" })];
    const first = await readAffaireItemHistory(PROJECT, itemId(1), { offset: 0, limit: 20 });
    expect(first).toMatchObject({ itemId: itemId(1), offset: 0, limit: 20, hasMore: true, names: { [MEMBER]: "Léa Martin" } });
    expect(first.events.map(({ id }) => id)).toEqual(Array.from({ length: 20 }, (_, index) => 21 - index));
    expect(first.events[0]).toMatchObject({ id: 21, event: "set_aside", planKey: PLAN, actorId: MEMBER });
    const second = await readAffaireItemHistory(PROJECT, itemId(1), { offset: 20, limit: 20 });
    expect(ranges).toEqual([[0, 20], [20, 40]]);
    expect(second).toMatchObject({ offset: 20, hasMore: false });
    expect(second.events.map(({ id }) => id)).toEqual([1]);
  });
});
