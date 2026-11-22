import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { countMarksEditRequestSchema } from "./count-marks-contracts";
import { editCountMarksAsMember, readCountMarkTargets, readCountMarksView } from "./count-marks-server";

// The routes of an item's counted marks (lot 5) over a database double: what the server adds to the database's own
// judgement. Review of #485, written before the fixes:
// - a page of marks and its count read at two revisions were answered together;
// - a refusal for a possible duplicate lost what the database named;
// - a plan already sent was refused by the route before the command could answer a replayed intention;
// - two revision keys differing by case were merged before the database could refuse them.
// Fictional identifiers.

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TENANT = "77777777-7777-4777-8777-777777777777";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const ANSWER = "a0000000-0000-4000-8000-000000000001";
const JOB = "f0000000-0000-4000-8000-000000000001";
const MARK = "d0000000-0000-4000-8000-000000000001";

const summary = (revision: number) => ({ revision, unit: "u", counted: true, proposed: 1, to_attribute: 0, retained: 0, removed: 0,
  pending: 0, reread: 0, scope_pages: 1, verified_pages: 0, quantity: null, state: "to_check", pages: [] });
const page = (revision: number) => ({ answer_id: ANSWER, page: 2, revision, geometry: null, total: 0, loaded: 0, next_after: null, marks: [] });

let pages: number[] = [];
let summaries: number[] = [];
let editError: { message: string; details?: string } | null = null;
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

function client() {
  const from = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in"]) builder[method] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [
      { id: ANSWER, item_id: ANSWER, job_id: JOB, plan_logical_id: JOB, reading_revision: 1, status: "completed" }], error: null })
      .then(resolve);
    return builder;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "read_takeoff_count_marks") return Promise.resolve({ data: page(pages.shift() ?? 1), error: null });
    if (name === "read_takeoff_count_mark_summaries") {
      return Promise.resolve({ data: [{ answer_id: ANSWER, summary: summary(summaries.shift() ?? 1) }], error: null });
    }
    if (name === "edit_takeoff_count_marks") {
      return Promise.resolve(editError ? { data: null, error: { code: "P0001", ...editError } }
        : { data: { replayed: true, command_id: MARK, revisions: { [ANSWER]: 3 }, added: [], summaries: {} }, error: null });
    }
    throw new Error(`Unexpected call of ${name}.`);
  };
  return { from, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  pages = [];
  summaries = [];
  editError = null;
  vi.mocked(requireAffaireAccess).mockResolvedValue({
    context: { supabase: client(), tenantId: TENANT, userId: MEMBER, tenantRole: "admin" },
    project: { id: PROJECT, tenant_id: TENANT, user_id: MEMBER, name: "Affaire", reference: null, client_name: null, is_archived: false },
  } as never);
});

describe("a page of marks and its count", () => {
  it("are answered together only at one revision, read again while they differ", async () => {
    pages = [2, 3];
    summaries = [3, 3];
    const view = await readCountMarksView(PROJECT, { answerId: ANSWER, page: 2 });
    expect(view.revision).toBe(3);
    expect(view.summary.revision).toBe(3);
    expect(calls.filter(({ name }) => name === "read_takeoff_count_marks")).toHaveLength(2);
  });

  it("are not answered while every read crosses a revision: the member is told they are changing", async () => {
    pages = [2, 3, 4];
    summaries = [3, 4, 5];
    await expect(readCountMarksView(PROJECT, { answerId: ANSWER, page: 2 })).rejects.toMatchObject({ status: 409,
      code: "TAKEOFF_MARKS_READ_CHANGING" });
  });
});

describe("the edit", () => {
  const command = { intentKey: MARK, revisions: { [ANSWER]: 2 }, gestures: [{ op: "verify" as const, answer_id: ANSWER, pages: [2] }] };

  it("passes on what a refusal for a possible duplicate names", async () => {
    editError = { message: "TAKEOFF_MARKS_OBJECT_DUPLICATE", details: JSON.stringify({ gesture: 1, twins: [MARK], added_keys: [] }) };
    await expect(editCountMarksAsMember(PROJECT, command)).rejects.toMatchObject({ status: 409, code: "TAKEOFF_MARKS_OBJECT_DUPLICATE",
      details: { gesture: 1, twins: [MARK], addedKeys: [] } });
  });

  it("leaves a sent plan to the command: a replayed intention gets its receipt, a new one the command's refusal", async () => {
    await expect(editCountMarksAsMember(PROJECT, command)).resolves.toMatchObject({ replayed: true });
    editError = { message: "TAKEOFF_MARKS_PLAN_SENT" };
    await expect(editCountMarksAsMember(PROJECT, command)).rejects.toMatchObject({ status: 409, code: "TAKEOFF_MARKS_PLAN_SENT" });
  });

  it("refuses an answer named twice in two cases rather than merging it", () => {
    const upper = ANSWER.toUpperCase();
    expect(countMarksEditRequestSchema.safeParse({ ...command, revisions: { [ANSWER]: 2, [upper]: 1 } }).success).toBe(false);
    expect(countMarksEditRequestSchema.safeParse(command).success).toBe(true);
  });
});

// Follow-ups of lot 5: a reattribution offered only the items of the table's page and filter. Its destinations are the
// other items the same reading answered (its job, on its plan) whose answer no later reading replaced, whatever the
// table shows, by their place in the reading's list. Fictional identifiers and labels.
describe("the destinations of a reattribution", () => {
  const PLAN = "a1000000-0000-4000-8000-000000000001";
  const LIST = "a2000000-0000-4000-8000-000000000001";
  const item = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const answerOf = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = {
    takeoff_item_answers: [
      { id: answerOf(1), item_id: item(1), job_id: JOB, plan_logical_id: PLAN, list_revision_id: LIST, reading_revision: 1 },
      // Two other items of the same reading, one of them read again since by a later job: its answer is replaced.
      { id: answerOf(2), item_id: item(2), job_id: JOB, plan_logical_id: PLAN, list_revision_id: LIST, reading_revision: 1 },
      { id: answerOf(3), item_id: item(3), job_id: JOB, plan_logical_id: PLAN, list_revision_id: LIST, reading_revision: 1 },
      { id: answerOf(4), item_id: item(3), job_id: MARK, plan_logical_id: PLAN, list_revision_id: LIST, reading_revision: 2 },
      // The same job on another plan, and another item placed before the others in the list.
      { id: answerOf(5), item_id: item(5), job_id: JOB, plan_logical_id: LIST, list_revision_id: LIST, reading_revision: 1 },
      { id: answerOf(6), item_id: item(6), job_id: JOB, plan_logical_id: PLAN, list_revision_id: LIST, reading_revision: 1 },
      { id: answerOf(7), item_id: item(7), job_id: JOB, plan_logical_id: PLAN, list_revision_id: LIST, reading_revision: 1 },
    ].map((answer) => ({ plan_content_sha256: "c".repeat(64), searched_pages: [2], unreadable_pages: answer.item_id === item(2) ? [7] : [],
      ...answer })),
    takeoff_list_revision_entries: [
      { revision_id: LIST, item_id: item(1), label: "Lavabo (fictif)", position: 0, expected_unit: "u" },
      { revision_id: LIST, item_id: item(2), label: "Vanne (fictive)", position: 5, expected_unit: "u" },
      { revision_id: LIST, item_id: item(3), label: "Siphon (fictif)", position: 3, expected_unit: "u" },
      { revision_id: LIST, item_id: item(6), label: "Évier (fictif)", position: 1, expected_unit: "u" },
      // Review of #496: an item of another unit, which the edit command refuses as a destination (the counterexample of
      // takeoff-count-marks.test.sql, « a mark counted in units cannot go to an item of another unit »).
      { revision_id: LIST, item_id: item(7), label: "Revêtement (fictif)", position: 2, expected_unit: "m2" },
    ],
  };
  function tableClient() {
    const from = (table: string) => {
      const filters: Array<(row: Row) => boolean> = [];
      let range: [number, number] | null = null;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => { filters.push((row) => column in row ? row[column] === value : true); return builder; };
      builder.neq = (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return builder; };
      builder.in = (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; };
      builder.order = () => builder;
      builder.range = (start: number, end: number) => { range = [start, end]; return builder; };
      const rows = () => {
        const matching = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        return range ? matching.slice(range[0], range[1] + 1) : matching;
      };
      builder.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve);
      return builder;
    };
    return { from, rpc: () => { throw new Error("no command here"); } };
  }

  it("are the reading's other items whose answer stands, in the list's order, whatever the table shows", async () => {
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { supabase: tableClient(), tenantId: TENANT, userId: MEMBER, tenantRole: "admin" },
      project: { id: PROJECT, tenant_id: TENANT, user_id: MEMBER, name: "Affaire", reference: null, client_name: null, is_archived: false },
    } as never);
    // The other unit left out; each destination with the pages its answer read (the command checks the mark's page in it).
    expect(await readCountMarkTargets(PROJECT, { answerId: answerOf(1).toUpperCase() })).toEqual({ answerId: answerOf(1), targets: [
      { answerId: answerOf(6), itemId: item(6), label: "Évier (fictif)", scopePages: [2] },
      { answerId: answerOf(2), itemId: item(2), label: "Vanne (fictive)", scopePages: [2, 7] },
    ] });
  });

  it("refuses an answer the member may not read", async () => {
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { supabase: tableClient(), tenantId: TENANT, userId: MEMBER, tenantRole: "admin" },
      project: { id: PROJECT, tenant_id: TENANT, user_id: MEMBER, name: "Affaire", reference: null, client_name: null, is_archived: false },
    } as never);
    await expect(readCountMarkTargets(PROJECT, { answerId: answerOf(9) })).rejects.toMatchObject({ status: 404,
      code: "TAKEOFF_MARKS_ANSWER_NOT_FOUND" });
  });
});

describe("the destinations of a reattribution, by unit as the edit command compares them", () => {
  it("compares the expected units null-safe: no unit goes to no unit, never to a unit", async () => {
    const PLAN = "a1000000-0000-4000-8000-000000000001";
    const LIST = "a2000000-0000-4000-8000-000000000001";
    const item = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const answerOf = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const rows: Record<string, Array<Record<string, unknown>>> = {
      takeoff_item_answers: [1, 2, 3].map((n) => ({ id: answerOf(n), item_id: item(n), job_id: JOB, plan_logical_id: PLAN,
        list_revision_id: LIST, reading_revision: 1, plan_content_sha256: "c".repeat(64), searched_pages: [2], unreadable_pages: [] })),
      takeoff_list_revision_entries: [
        { revision_id: LIST, item_id: item(1), label: "Sans unité (fictif)", position: 0, expected_unit: null },
        { revision_id: LIST, item_id: item(2), label: "Sans unité aussi (fictif)", position: 1, expected_unit: null },
        { revision_id: LIST, item_id: item(3), label: "À l’unité (fictif)", position: 2, expected_unit: "u" },
      ],
    };
    const from = (table: string) => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder: Record<string, unknown> = {};
      for (const name of ["select", "order"]) builder[name] = () => builder;
      builder.eq = (column: string, value: unknown) => { filters.push((row) => column in row ? row[column] === value : true); return builder; };
      builder.neq = (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return builder; };
      builder.in = (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return builder; };
      builder.range = () => builder;
      const result = () => (rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      builder.maybeSingle = () => Promise.resolve({ data: result()[0] ?? null, error: null });
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve);
      return builder;
    };
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { supabase: { from }, tenantId: TENANT, userId: MEMBER, tenantRole: "admin" },
      project: { id: PROJECT, tenant_id: TENANT, user_id: MEMBER, name: "Affaire", reference: null, client_name: null, is_archived: false },
    } as never);
    expect((await readCountMarkTargets(PROJECT, { answerId: answerOf(1) })).targets.map(({ itemId }) => itemId)).toEqual([item(2)]);
    expect((await readCountMarkTargets(PROJECT, { answerId: answerOf(3) })).targets).toEqual([]);
  });
});
