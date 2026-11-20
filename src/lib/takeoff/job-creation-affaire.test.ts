import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createAffaireTakeoffJob } from "@/lib/takeoff/job-creation-server";
import {
  authenticatedContext, createSupabaseFake, filterValue, M3_ITEM_ID, M3_PLAN_SET_ID, M3_PROJECT_ID, M3_TENANT_ID,
} from "@/lib/takeoff/metre-m3.test-utils";
import { assertConfirmedTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/takeoff/preparation-server", () => ({ assertConfirmedTakeoffPreparation: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 50 }),
  getTakeoffChunkingConfigForTenant: vi.fn(),
}));
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>(),
  getTakeoffExecutionOwner: vi.fn(),
  assertLocalTakeoffResumeReady: vi.fn().mockResolvedValue(undefined),
}));

const request = { projectId: M3_PROJECT_ID, planSetId: M3_PLAN_SET_ID, preparationRevision: 1,
  operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

function fixture(tenantRole: "admin" | "director" = "admin") {
  const jobs = new Map<string, Record<string, unknown>>();
  const database = createSupabaseFake({
    tables: {
      estimate_projects: () => ({ data: { id: M3_PROJECT_ID }, error: null }),
      plan_sets: () => ({ data: { id: M3_PLAN_SET_ID }, error: null }),
      plan_files: () => ({
        data: [{ id: M3_ITEM_ID, file_name: "Plan fictif.pdf", file_path: "fixture/plan.pdf",
          file_type: "application/pdf", file_size_bytes: 2048, page_count: 1 }],
        error: null, count: 1,
      }),
      takeoff_jobs: (query) => {
        if (query.operation === "select") return { data: jobs.get(String(filterValue(query, "id"))) ?? null, error: null };
        const row = query.payload as Record<string, unknown>;
        const job = { ...row, created_at: "2026-11-20T00:00:00Z" };
        jobs.set(String(row.id), job);
        return { data: job, error: null };
      },
    },
  });
  const audit = createSupabaseFake({ tables: { audit_logs: () => ({ data: null, error: null }) } });
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ ...authenticatedContext(database), tenantRole } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(audit.client as never);
  return { database, audit };
}

beforeEach(() => {
  vi.clearAllMocks();
  const preparation = confirmedPreparationFixture();
  preparation.preparation.destination = { kind: "analysis_only", estimate_version_id: null, confirmed: true, reviewer: null };
  preparation.preparation.processing = { level: "C", provider: "chatgpt" };
  vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue(preparation);
  vi.mocked(getTakeoffExecutionOwner).mockResolvedValue({
    execution_provider: "chatgpt_local", execution_host_id: "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
});

describe("admitting a prepared affaire takeoff", () => {
  it("admits and audits the prepared local job without reading or creating a version", async () => {
    const { database, audit } = fixture();

    const receipt = await createAffaireTakeoffJob(request);

    expect(receipt).toMatchObject({ project_id: M3_PROJECT_ID, estimate_version_id: null, level: "C", status: "pending" });
    expect(database.writesTo("takeoff_jobs")).toEqual([expect.objectContaining({
      payload: expect.objectContaining({ id: receipt.id, tenant_id: M3_TENANT_ID, plan_set_id: M3_PLAN_SET_ID,
        project_id: M3_PROJECT_ID, estimate_version_id: null, source_file_path: null,
        execution_provider: "chatgpt_local", processing_strategy: "sync" }),
    })]);
    expect(audit.writesTo("audit_logs")[0]?.payload).toMatchObject({
      action: "takeoff.job.created", record_id: receipt.id, estimate_version_id: null,
      after_data: { metadata: { project_id: M3_PROJECT_ID, estimate_version_id: null } },
    });
    expect(database.tablesTouched).not.toContain("estimate_versions");
    expect(database.tablesTouched).not.toContain("estimate_items");
    expect(database.storageCalls).toEqual([]);
  });

  it("refuses a read-only member before resolving an execution owner", async () => {
    const { database, audit } = fixture("director");

    await expect(createAffaireTakeoffJob(request)).rejects.toMatchObject({ status: 403 });
    expect(getTakeoffExecutionOwner).not.toHaveBeenCalled();
    expect(database.writesTo("takeoff_jobs")).toEqual([]);
    expect(audit.writesTo("audit_logs")).toEqual([]);
  });

  it("replays the same operation and admits a distinct operation for the same preparation", async () => {
    const { database } = fixture();
    const first = await createAffaireTakeoffJob(request);
    expect(await createAffaireTakeoffJob(request)).toEqual(first);
    const second = await createAffaireTakeoffJob({ ...request, operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(second.id).not.toEqual(first.id);
    await expect(createAffaireTakeoffJob({ ...request, preparationRevision: 2 })).rejects.toMatchObject({
      status: 409, code: "CONFLICT",
    });
    expect(database.writesTo("takeoff_jobs")).toHaveLength(2);
  });
});
