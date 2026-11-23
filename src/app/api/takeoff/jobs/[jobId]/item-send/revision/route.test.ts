import { beforeEach, expect, it, vi } from "vitest";
import { unauthorized } from "@/lib/http/api-response";
import { POST } from "./route";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";

vi.mock("@/lib/takeoff/job-read-server", () => ({ getAuthenticatedTakeoffContext: vi.fn() }));
vi.mock("@/lib/takeoff/item-send-preview-server", () => ({ itemSendMemberMayWrite: async () => true }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc }) }));

const job = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const version = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const receipt = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const answer = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const scope = { version_id: version, receipt_id: receipt };
const entry = { action: "entry", ...scope, answer_id: answer, intent_id: answer, expected_revision: 0 };
const survey = { quantity: 3, unit: "u", category: "site_survey" };
const rpc = vi.fn();
const receiptFilter = vi.fn();
function post(body: unknown, jobId = job) {
  return POST(new Request("http://localhost/revision", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ jobId }),
  });
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { replayed: false } });
  receiptFilter.mockClear();
  const from = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      or: (filter: string) => {
        receiptFilter(filter);
        return query;
      },
      maybeSingle: async () => ({
        data: table === "takeoff_jobs" ? { project_id: answer } : { estimate_versions: { currency: "EUR" } },
      }),
    };
    return query;
  };
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({
    supabase: { from, rpc },
    userId: job,
    tenantId: answer,
    tenantRole: "admin",
  } as unknown as Awaited<ReturnType<typeof getAuthenticatedTakeoffContext>>);
});

it.each(["", " \t\n ", "  "])("saves a documented entry with a blank optional note", async (note) => {
  const response = await post({ ...entry, entry: { ...survey, note } });
  expect(response.status).toBe(200);
  expect(rpc.mock.calls[0][1].p_entry).toStrictEqual(survey);
});

it("explains a missing hypothesis justification before writing", async () => {
  const response = await post({ ...entry, entry: { ...survey, category: "hypothesis", note: "   " } });
  expect(response.status).toBe(422);
  expect((await response.json()).error.message).toContain("hypothèse");
  expect(rpc).not.toHaveBeenCalled();
});

it("addresses the amended receipt of a copy with canonical UUIDs", async () => {
  const response = await post(
    {
      ...entry,
      version_id: version.toUpperCase(),
      receipt_id: receipt.toUpperCase(),
      answer_id: answer.toUpperCase(),
      intent_id: answer.toUpperCase(),
      entry: survey,
    },
    job.toUpperCase(),
  );
  expect(response.status).toBe(200);
  expect(receiptFilter).toHaveBeenCalledWith(`job_id.eq.${job},write_plan->>source_job_id.eq.${job}`);
  expect(rpc.mock.calls[0][1]).toMatchObject({
    p_version: version,
    p_receipt: receipt,
    p_answer: answer,
    p_intent: answer,
  });
});

it.each([
  { ...entry, entry: survey, expected_revision: 2147483648 },
  ...["work_revision", "marks_revision", "plan_entry_revision"].map((field) => ({
    action: "choose",
    ...scope,
    answer_id: answer,
    intent_id: answer,
    expected: {
      work_revision: 1,
      marks_revision: 1,
      plan_entry_revision: 1,
      answer_revision: "a".repeat(64),
      [field]: 2147483648,
    },
    choice: { source: "measured" },
  })),
])("rejects a revision outside the database integer range before any writer runs", async (command) => {
  expect((await post(command)).status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
});

it("returns a named refusal, and logs an unrecognised writer message only on the server", async () => {
  rpc.mockResolvedValueOnce({ error: { message: "TAKEOFF_REVISION_STALE" } });
  const known = await post({ ...entry, entry: survey });
  expect(known.status).toBe(409);
  expect((await known.json()).error.details.reason).toBe("TAKEOFF_REVISION_STALE");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    rpc.mockResolvedValueOnce({ error: { message: "fixture provider diagnostic" } });
    const unknown = await post({ ...entry, entry: survey });
    expect(unknown.status).toBe(500);
    expect(await unknown.text()).not.toContain("fixture provider diagnostic");
    expect(JSON.stringify(log.mock.calls)).toContain("fixture provider diagnostic");
  } finally {
    log.mockRestore();
  }
});

it("keeps unknown provider messages out of addition blockers", async () => {
  const blockers = [
    { reason: "addition_refused", code: "fixture addition diagnostic", detail: "fixture private detail" },
    { reason: "addition_refused", code: "TAKEOFF_ITEM_SEND_QUANTITY_UNWRITABLE" },
  ];
  rpc.mockResolvedValueOnce({
    data: { digest: "b".repeat(64), changes: [], blockers, additions: [], actions: [], left_out: [] },
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await post({ action: "preview", ...scope, choices: {} });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.preview.blockers[0]).toEqual({ reason: "addition_refused" });
    expect(body.data.preview.blockers[1].message).toContain("trois décimales");
    expect(JSON.stringify(log.mock.calls)).toContain("fixture addition diagnostic");
  } finally {
    log.mockRestore();
  }
});

it("returns the route's French authentication response to an anonymous member", async () => {
  vi.mocked(getAuthenticatedTakeoffContext).mockRejectedValueOnce(unauthorized());
  const response = await post({ ...entry, entry: survey });
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    ok: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Connectez-vous pour consulter ou corriger cet envoi.",
    },
  });
  expect(rpc).not.toHaveBeenCalled();
});
