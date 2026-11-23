import { beforeEach, expect, it, vi } from "vitest";
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
