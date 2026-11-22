import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseFake } from "@/lib/takeoff/metre-m3.test-utils";

vi.mock("@/lib/takeoff/job-read-server", () => ({ getTakeoffJobDetails: vi.fn(), getAuthenticatedTakeoffContext: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-context-server", () => ({ loadTakeoffDpgfComparisonContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetails } from "@/lib/takeoff/job-read-server";
import { getTakeoffReviewContext } from "@/lib/takeoff/review-context-server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const LINE = "55555555-5555-4555-8555-555555555555";

// Lot 3: the review of a plan sent says what its send compared that changed since (public.read_takeoff_send_drift, read
// by the service once the member's own read of the job succeeded), on every answer for a sent job.
describe("getTakeoffReviewContext — what changed since a plan was sent", () => {
  let driftCalls: Array<Record<string, unknown>>;
  let drift: { data: unknown; error: unknown };

  function setUp(versionId: string | null, versionStatus = "issued") {
    vi.mocked(getTakeoffJobDetails).mockResolvedValue({ job: { id: JOB, project_id: PROJECT, estimate_version_id: versionId } } as never);
    const member = createSupabaseFake({
      tables: { estimate_versions: () => ({ data: { id: VERSION, project_id: PROJECT, status: versionStatus }, error: null }) },
    });
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: member.client, tenantId: TENANT } as never);
    vi.mocked(loadTakeoffDpgfComparisonContext).mockResolvedValue({ comparisonInput: { versionId: VERSION, jobId: JOB, dpgfLines: [],
      takeoffLines: [] }, takeoffItems: [] } as never);
    const service = createSupabaseFake({
      rpc: { read_takeoff_send_drift: (args) => { driftCalls.push(args as Record<string, unknown>); return drift; } },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    driftCalls = [];
    drift = { data: null, error: null };
  });

  it("reads nothing for a takeoff not sent", async () => {
    setUp(null);
    expect((await getTakeoffReviewContext(JOB)).send_context).toBeNull();
    expect(driftCalls).toEqual([]);
  });

  it("answers what the send compared that changed since, with the lines it sent, for the job's affaire", async () => {
    drift = { data: { changed: true, sent_at: "2026-11-22T10:00:00Z", item_ids: [LINE],
      changes: [{ reason: "location_changed", plan_name: "plan-b.pdf" }] }, error: null };
    setUp(VERSION);
    expect((await getTakeoffReviewContext(JOB)).send_context).toEqual({ changed: true, sent_at: "2026-11-22T10:00:00Z", item_ids: [LINE],
      changes: [{ reason: "location_changed", plan_name: "plan-b.pdf" }] });
    expect(driftCalls).toEqual([{ p_tenant_id: TENANT, p_project_id: PROJECT, p_job_id: JOB }]);
  });

  it("answers null for a takeoff the database does not compare (grouped, standalone, sent before)", async () => {
    setUp(VERSION);
    expect((await getTakeoffReviewContext(JOB)).send_context).toBeNull();
  });

  it("says when it cannot read it, rather than showing nothing changed", async () => {
    drift = { data: null, error: { message: "fictif", code: "XX000" } };
    setUp(VERSION);
    await expect(getTakeoffReviewContext(JOB)).rejects.toMatchObject({ message: expect.stringContaining("depuis l’envoi") });
  });
});
