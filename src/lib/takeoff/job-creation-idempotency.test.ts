import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createTakeoffJobFromPlanSet, findTakeoffJobForPlanSetLaunch } from "@/lib/takeoff/job-creation-server";
import { derivePlanSetTakeoffJobId } from "@/lib/takeoff/job-creation-input";
import { authenticatedContext, createSupabaseFake, filterValue, M3_PLAN_SET_ID, M3_PROJECT_ID, M3_TENANT_ID, M3_USER_ID, M3_VERSION_ID } from "@/lib/takeoff/metre-m3.test-utils";
import { getTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-takeoff", () => ({ getTakeoffExecutionOwner: vi.fn() }));
vi.mock("@/lib/takeoff/preparation-server", () => ({ assertConfirmedTakeoffPreparation: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffGeminiDeliveryConfigForTenant: vi.fn().mockResolvedValue({ useBatchApi: false }),
  getTakeoffChunkingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 200 }),
}));

const SOURCE_ID = "99999999-9999-4999-8999-999999999999";
const base = { projectId: M3_PROJECT_ID, planSetId: M3_PLAN_SET_ID, estimateVersionId: M3_VERSION_ID, preparationRevision: 2, level: "B" as const };

function fixture() {
  const job = {
    id: derivePlanSetTakeoffJobId({ ...base, tenantId: M3_TENANT_ID, sourceVersionId: SOURCE_ID }),
    estimate_version_id: M3_VERSION_ID, status: "pending", level: "B", source_file_name: "Plan fictif.pdf",
    source_file_path: "tenant/plans/file.pdf", created_at: "2026-10-29T00:00:00Z",
  };
  const fake = createSupabaseFake({ tables: {
    takeoff_jobs: (query) => {
      const id = filterValue(query, "id");
      const matches = id ? id === job.id :
        filterValue(query, "estimate_version_id") === M3_VERSION_ID &&
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

beforeEach(() => vi.clearAllMocks());

describe("prepared plan launch receipts", () => {
  it("recovers the source-version receipt after reopening the hub on its created draft", async () => {
    const { fake, job } = fixture();
    const recovered = await findTakeoffJobForPlanSetLaunch(base);
    expect(recovered?.id).toBe(job.id);
    expect(fake.queries.filter((query) => query.table === "takeoff_jobs")).toHaveLength(2);
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

  it.each(["gemini", "chatgpt_local"] as const)("recovers the unique target receipt across different IDs after an atomic %s conflict", async (executionProvider) => {
    let winnerVisible = false;
    const winningJob = {
      id: derivePlanSetTakeoffJobId({ ...base, tenantId: M3_TENANT_ID }),
      estimate_version_id: M3_VERSION_ID, status: "pending", level: "B", source_file_name: "Plan fictif.pdf",
      source_file_path: "tenant/plans/file.pdf", created_at: "2026-10-29T00:00:00Z",
    };
    const snapshot = confirmedPreparationFixture();
    snapshot.preparation.sources[0] = { ...snapshot.preparation.sources[0], kind: "plan", document_id: "plan-file", plan_set_id: M3_PLAN_SET_ID };
    vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue(snapshot);
    vi.mocked(getTakeoffExecutionOwner).mockResolvedValue(executionProvider === "gemini" ? {} : { execution_provider: "chatgpt_local", execution_host_id: "fixture-host" });
    const fake = createSupabaseFake({ tables: {
      takeoff_jobs: (query) => {
        if (query.operation === "insert") {
          expect((query.payload as { id: string }).id).not.toBe(winningJob.id);
          winnerVisible = true;
          return { data: null, error: { code: "23505", message: "takeoff_jobs_prepared_plan_receipt_uidx" } };
        }
        if (filterValue(query, "id")) return { data: null, error: null };
        if (!winnerVisible) return { data: null, error: null };
        expect(filterValue(query, "execution_provider")).toBe(executionProvider);
        return { data: winningJob, error: null };
      },
      estimate_versions: () => ({ data: { id: M3_VERSION_ID, status: "draft", estimate_projects: { tenant_id: M3_TENANT_ID, user_id: M3_USER_ID } }, error: null }),
      plan_sets: () => ({ data: { id: M3_PLAN_SET_ID }, error: null }),
      plan_files: () => ({ data: [{ id: "plan-file", file_path: winningJob.source_file_path, file_name: "Plan fictif.pdf", file_type: "application/pdf", file_size_bytes: 1000, page_count: 1, metadata: {} }], error: null, count: 1 }),
    } });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
    const result = await createTakeoffJobFromPlanSet({ ...base, sourceVersionId: SOURCE_ID });
    expect(result.id).toBe(winningJob.id);
    expect(fake.writesTo("takeoff_jobs")).toHaveLength(1);
    expect(fake.writesTo("audit_logs")).toEqual([]);
  });
});
