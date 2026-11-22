import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { countMarksEditRequestSchema } from "./count-marks-contracts";
import { editCountMarksAsMember, readCountMarksView } from "./count-marks-server";

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
