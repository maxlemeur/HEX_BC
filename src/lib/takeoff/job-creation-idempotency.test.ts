import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createTakeoffJobFromPlanSet, findTakeoffJobForPlanSetLaunch } from "@/lib/takeoff/job-creation-server";
import { derivePlanSetTakeoffJobId } from "@/lib/takeoff/job-creation-input";
import { authenticatedContext, createSupabaseFake, filterValue, M3_PLAN_SET_ID, M3_PROJECT_ID, M3_TENANT_ID, M3_USER_ID, M3_VERSION_ID } from "@/lib/takeoff/metre-m3.test-utils";
import { getConfirmedTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
// The resume check of a pending receipt is stubbed: chatgpt-takeoff.test.ts covers it.
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>();
  return { ...actual, getConfirmedTakeoffExecutionOwner: vi.fn(), assertLocalTakeoffResumeReady: vi.fn() };
});
vi.mock("@/lib/takeoff/preparation-server", () => ({ assertConfirmedTakeoffPreparation: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 200 }),
  getTakeoffChunkingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 200 }),
}));

const SOURCE_ID = "99999999-9999-4999-8999-999999999999";
const base = { projectId: M3_PROJECT_ID, planSetId: M3_PLAN_SET_ID, estimateVersionId: M3_VERSION_ID, preparationRevision: 2, level: "B" as const, provider: "auto" as const };

function confirmedRevision(revision = 2) {
  return { ...confirmedPreparationFixture(), preparation_revision: revision };
}

function fixture(preparationSnapshot: unknown = confirmedRevision(), createdBy = M3_USER_ID) {
  const job = {
    created_by: createdBy,
    id: derivePlanSetTakeoffJobId({ ...base, tenantId: M3_TENANT_ID, sourceVersionId: SOURCE_ID }),
    project_id: M3_PROJECT_ID, plan_set_id: M3_PLAN_SET_ID,
    estimate_version_id: M3_VERSION_ID, status: "pending", level: "B", source_file_name: "Plan fictif.pdf",
    source_file_path: "tenant/plans/file.pdf", created_at: "2026-10-29T00:00:00Z", execution_provider: "chatgpt_local",
    preparation_snapshot: preparationSnapshot,
  };
  const fake = createSupabaseFake({ tables: {
    takeoff_jobs: (query) => {
      const id = filterValue(query, "id");
      const matches = id ? id === job.id :
        filterValue(query, "estimate_version_id") === M3_VERSION_ID &&
        filterValue(query, "project_id") === M3_PROJECT_ID &&
        filterValue(query, "plan_set_id") === M3_PLAN_SET_ID &&
        filterValue(query, "preparation_snapshot->>preparation_revision") === "2" &&
        filterValue(query, "level") === "B" &&
        (!filterValue(query, "execution_provider") || filterValue(query, "execution_provider") === "gemini");
      return { data: matches ? job : null, error: null };
    },
    estimate_versions: () => ({ data: { id: M3_VERSION_ID, status: "draft", estimate_projects: { tenant_id: M3_TENANT_ID, user_id: M3_USER_ID } }, error: null }),
  } });
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
  return { fake, job };
}

beforeEach(() => {
  vi.clearAllMocks();
  const audit = createSupabaseFake({ tables: { audit_logs: () => ({ data: { id: "creation-record" }, error: null }) } });
  vi.mocked(createServiceRoleClient).mockReturnValue(audit.client as never);
});

describe("prepared plan launch receipts", () => {
  it("recovers the source-version receipt after reopening the hub on its created draft", async () => {
    const { fake, job } = fixture();
    const recovered = await findTakeoffJobForPlanSetLaunch(base);
    expect(recovered?.id).toBe(job.id);
    expect(fake.queries.filter((query) => query.table === "takeoff_jobs")).toHaveLength(2);
    expect(fake.queries.filter((query) => query.operation !== "select")).toEqual([]);
  });

  it("refuses to start another member's pending job on a replayed launch", async () => {
    const { fake } = fixture(undefined, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    for (const launch of [base, { ...base, sourceVersionId: SOURCE_ID }]) {
      await expect(findTakeoffJobForPlanSetLaunch(launch)).rejects.toMatchObject({
        status: 403, code: "FORBIDDEN", message: expect.stringContaining("Préparez une nouvelle analyse"),
      });
    }
    expect(fake.queries.filter((query) => query.operation !== "select")).toEqual([]);
  });

  it("keeps a changed preparation, plan set, level or explicit provider distinct", async () => {
    fixture();
    expect(await findTakeoffJobForPlanSetLaunch({ ...base, preparationRevision: 3 })).toBeNull();
    expect(await findTakeoffJobForPlanSetLaunch({ ...base, planSetId: SOURCE_ID })).toBeNull();
    expect(await findTakeoffJobForPlanSetLaunch({ ...base, level: "C" })).toBeNull();
    expect(await findTakeoffJobForPlanSetLaunch({ ...base, provider: "chatgpt" })).toBeNull();
  });

  it("uses the same deterministic source receipt during concurrent fork attempts", async () => {
    const { fake, job } = fixture();
    expect((await findTakeoffJobForPlanSetLaunch({ ...base, sourceVersionId: SOURCE_ID }))?.id).toBe(job.id);
    expect(fake.queries.filter((query) => query.table === "takeoff_jobs")).toHaveLength(1);
  });

  it("replays an old receipt when the caller omits both processing choices", async () => {
    const snapshot = confirmedRevision();
    snapshot.preparation.processing = { level: "B", provider: "auto" };
    const { fake, job } = fixture(snapshot);
    const recovered = await createTakeoffJobFromPlanSet({ ...base, level: undefined, provider: undefined, sourceVersionId: SOURCE_ID });
    expect(recovered.id).toBe(job.id);
    expect(fake.queries.filter((query) => query.table === "takeoff_jobs")).toHaveLength(1);
    expect(fake.writesTo("takeoff_jobs")).toEqual([]);
  });

  it.each([
    ["plan set", { plan_set_id: SOURCE_ID }],
    ["affaire", { project_id: SOURCE_ID }],
    ["preparation revision", { preparation_snapshot: confirmedRevision(3) }],
  ])("refuses a deterministic receipt whose %s does not match the request", async (_field, mismatch) => {
    const { job } = fixture();
    Object.assign(job, { plan_set_id: M3_PLAN_SET_ID, project_id: M3_PROJECT_ID,
      preparation_snapshot: confirmedRevision() }, mismatch);
    await expect(findTakeoffJobForPlanSetLaunch({ ...base, sourceVersionId: SOURCE_ID })).rejects.toMatchObject({ status: 409 });
  });

  it("recovers a copied draft from its source using the scoped copy receipt", async () => {
    const { job } = fixture();
    const audit = createSupabaseFake({ tables: {
      audit_logs: (query) => ({
        data: filterValue(query, "action") === "takeoff.job.created" ||
          (filterValue(query, "action") === "takeoff.preparation.version_created" &&
            filterValue(query, "tenant_id") === M3_TENANT_ID &&
            filterValue(query, "after_data->>project_id") === M3_PROJECT_ID &&
            filterValue(query, "after_data->>source_version_id") === SOURCE_ID &&
            filterValue(query, "after_data->>target_version_id") === M3_VERSION_ID &&
            filterValue(query, "after_data->>preparation_revision") === "2") ? { id: "receipt" } : null,
        error: null,
      }),
    } });
    vi.mocked(createServiceRoleClient).mockReturnValue(audit.client as never);
    const receipt = await findTakeoffJobForPlanSetLaunch({ ...base, estimateVersionId: SOURCE_ID, sourceVersionId: SOURCE_ID });
    expect(receipt).toMatchObject({ id: job.id, estimate_version_id: M3_VERSION_ID });
    expect(audit.queries.map(query => filterValue(query, "action"))).toEqual([
      "takeoff.preparation.version_created", "takeoff.job.created",
    ]);
  });

  it("refuses a different target without the source-to-target copy receipt", async () => {
    const { job } = fixture();
    Object.assign(job, { plan_set_id: M3_PLAN_SET_ID, project_id: M3_PROJECT_ID,
      preparation_snapshot: confirmedRevision() });
    const audit = createSupabaseFake({ tables: {
      audit_logs: (query) => ({
        data: filterValue(query, "action") === "takeoff.job.created" ? { id: "creation-record" } : null,
        error: null,
      }),
    } });
    vi.mocked(createServiceRoleClient).mockReturnValue(audit.client as never);
    await expect(findTakeoffJobForPlanSetLaunch({ ...base, estimateVersionId: SOURCE_ID, sourceVersionId: SOURCE_ID }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("rejects contradictory confirmed choices before returning even a matching receipt", async () => {
    const snapshot = confirmedRevision();
    snapshot.preparation.processing = { level: "B", provider: "auto" };
    fixture(snapshot);
    // Explicit Gemini could use the same effective provider as auto; changing
    // the requested choice still requires a new confirmed preparation revision.
    await expect(findTakeoffJobForPlanSetLaunch({ ...base, provider: "gemini" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("réglages de traitement") });
    snapshot.preparation.processing = { level: "C", provider: "auto" };
    await expect(findTakeoffJobForPlanSetLaunch({ ...base, sourceVersionId: SOURCE_ID })).rejects.toMatchObject({ status: 409 });
    expect(getConfirmedTakeoffExecutionOwner).not.toHaveBeenCalled();
  });

  it.each([
    ["processing", M3_USER_ID, true],
    ["pending", M3_USER_ID, true],
    ["pending", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", false],
  ] as const)("after an atomic chatgpt_local conflict, recovers a %s winner across different IDs only for its creator (%s)", async (status, createdBy, recovered) => {
    const executionProvider = "chatgpt_local";
    const launch = { ...base, level: "C", provider: "chatgpt" } as const;
    let winnerVisible = false;
    const winningJob = {
      id: derivePlanSetTakeoffJobId({ ...launch, tenantId: M3_TENANT_ID }),
      project_id: M3_PROJECT_ID, plan_set_id: M3_PLAN_SET_ID, preparation_snapshot: confirmedRevision(),
      estimate_version_id: M3_VERSION_ID, status, level: "C", source_file_name: "Plan fictif.pdf", created_by: createdBy,
      source_file_path: "tenant/plans/file.pdf", created_at: "2026-10-29T00:00:00Z", execution_provider: "chatgpt_local",
    };
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.sources[0] = { ...snapshot.preparation.sources[0], kind: "plan", document_id: "plan-file", plan_set_id: M3_PLAN_SET_ID };
    vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue(snapshot);
    vi.mocked(getConfirmedTakeoffExecutionOwner).mockResolvedValue({ execution_provider: "chatgpt_local", execution_host_id: "fixture-host" });
    const fake = createSupabaseFake({ tables: {
      takeoff_jobs: (query) => {
        if (filterValue(query, "id")) return { data: null, error: null };
        if (!winnerVisible) return { data: null, error: null };
        expect(filterValue(query, "execution_provider")).toBe(executionProvider);
        return { data: winningJob, error: null };
      },
      estimate_versions: () => ({ data: { id: M3_VERSION_ID, status: "draft", estimate_projects: { tenant_id: M3_TENANT_ID, user_id: M3_USER_ID } }, error: null }),
      plan_sets: () => ({ data: { id: M3_PLAN_SET_ID }, error: null }),
      plan_files: () => ({ data: [{ id: "plan-file", file_path: winningJob.source_file_path, file_name: "Plan fictif.pdf", file_type: "application/pdf", file_size_bytes: 1000, page_count: 1, metadata: {} }], error: null, count: 1 }),
    }, rpc: {
      admit_prepared_takeoff_job: (args) => {
        expect((args as { p_job: { id: string } }).p_job.id).not.toBe(winningJob.id);
        winnerVisible = true;
        return { data: null, error: { code: "23505", message: "takeoff_jobs_prepared_plan_receipt_uidx" } };
      },
    } });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
    const creation = createTakeoffJobFromPlanSet({ ...launch, sourceVersionId: SOURCE_ID });
    if (recovered) expect((await creation).id).toBe(winningJob.id);
    else await expect(creation).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(fake.rpcCalls.map(call => call.fn)).toEqual(["admit_prepared_takeoff_job"]);
    expect(fake.writesTo("takeoff_jobs")).toEqual([]);
    expect(fake.writesTo("audit_logs")).toEqual([]);
  });
});
