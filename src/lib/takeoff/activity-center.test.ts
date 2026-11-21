import { beforeEach, describe, expect, it, vi } from "vitest";

// Pagination faults are covered with the real SDK in read-all.test.ts.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

// The request runs on the local Mac that launched the jobs (the resume policy compares the two); CI disables the real one.
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3000" })) }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: vi.fn(() => true), assertLocalChatGptHost: vi.fn(),
  hasLocalChatGptPlanAccess: vi.fn((profile: { accessToken?: string }) => Boolean(profile.accessToken)),
}));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({
  getChatGptHostId: vi.fn(async () => "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
  readChatGptStore: vi.fn(async () => ({ selectedId: "profile-1", profiles: [{ id: "profile-1", accessToken: "fixture", model: "fixture-model" }] })),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { listActivityCenterJobs } from "@/lib/takeoff/activity-center";
import { takeoffActivityCenterResponseSchema } from "@/lib/takeoff/activity-center-contracts";
import { getTakeoffJobDetails } from "@/lib/takeoff/job-read-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PLAN_SET_A_ID = "44444444-4444-4444-8444-444444444444";
const PLAN_SET_B_ID = "55555555-5555-4555-8555-555555555555";
const JOB_A_ID = "66666666-6666-4666-8666-666666666666";
const JOB_B_ID = "77777777-7777-4777-8777-777777777777";
const JOB_C_ID = "88888888-8888-4888-8888-888888888888";
const EVENT_ID = "99999999-9999-4999-8999-999999999999";
const FINISHED_AT = "2026-11-20T08:00:00.000Z";

type QueryRow = Record<string, unknown>;
type SelectOptions = {
  count?: "exact";
  head?: boolean;
};

function compareValues(left: unknown, right: unknown) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left ?? "").localeCompare(String(right ?? ""), "fr-FR");
}

function createSelectBuilder<T extends QueryRow>(
  rows: T[],
  options?: SelectOptions
) {
  const eqFilters = new Map<string, unknown>();
  const inFilters = new Map<string, unknown[]>();
  const gteFilters = new Map<string, string>();
  const orderBy: Array<{ column: string; ascending: boolean }> = [];
  let range: { start: number; end: number } | null = null;

  const evaluate = () => {
    const filtered = rows
      .filter((row) => {
        for (const [column, value] of eqFilters.entries()) {
          if (row[column] !== value) {
            return false;
          }
        }

        for (const [column, values] of inFilters.entries()) {
          if (!values.includes(row[column])) {
            return false;
          }
        }

        for (const [column, value] of gteFilters.entries()) {
          if (String(row[column] ?? "").localeCompare(value) < 0) {
            return false;
          }
        }

        return true;
      })
      .sort((left, right) => {
        for (const { column, ascending } of orderBy) {
          const comparison = compareValues(left[column], right[column]);
          if (comparison !== 0) {
            return ascending ? comparison : -comparison;
          }
        }

        return 0;
      });

    const count = filtered.length;
    const data = range
      ? filtered.slice(range.start, range.end + 1)
      : filtered;

    return {
      data: options?.head ? null : data,
      count: options?.count === "exact" ? count : null,
      error: null,
    };
  };

  const builder = {
    eq: vi.fn((column: string, value: unknown) => {
      eqFilters.set(column, value);
      return builder;
    }),
    in: vi.fn((column: string, values: unknown[]) => {
      inFilters.set(column, values);
      return builder;
    }),
    gte: vi.fn((column: string, value: string) => {
      gteFilters.set(column, value);
      return builder;
    }),
    order: vi.fn((column: string, order?: { ascending?: boolean }) => {
      orderBy.push({ column, ascending: order?.ascending ?? true });
      return builder;
    }),
    range: vi.fn((start: number, end: number) => {
      range = { start, end };
      return builder;
    }),
    limit: vi.fn((limit: number) => {
      range = { start: 0, end: limit - 1 };
      return builder;
    }),
    maybeSingle: vi.fn(async () => {
      const response = evaluate();
      const rowsData = (response.data as T[] | null) ?? [];
      return {
        data: rowsData[0] ?? null,
        error: null,
      };
    }),
    then: (
      onFulfilled?: (value: ReturnType<typeof evaluate>) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(evaluate()).then(onFulfilled, onRejected),
  };

  return builder;
}

function createSupabaseMock(input?: {
  estimateItems?: Array<{
    id: string;
    version_id: string;
    item_type: "line" | "section";
    tenant_id: string;
  }>;
  jobPatches?: Record<string, QueryRow>;
  planFilePatches?: Record<string, QueryRow>;
  archived?: boolean;
  director?: boolean;
  /** Replaces the three default jobs. */
  jobs?: QueryRow[];
  /** The count of lines each job has in the grouped read, when it differs from the fixture's line rows. */
  itemCounts?: Record<string, number>;
  projectOwner?: string;
}) {
  const versions = [
    {
      id: VERSION_ID,
      version_number: 3,
      project_id: PROJECT_ID,
      tenant_id: TENANT_ID,
    },
  ];

  const takeoffJobs = [
    {
      id: JOB_A_ID,
      project_id: PROJECT_ID,
      estimate_version_id: VERSION_ID,
      source_file_name: "cvc-a.pdf",
      source_file_type: "application/pdf",
      level: "A",
      status: "completed",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_batch_updated_at: null,
      provider_reconcile_due_at: null,
      provider_reconcile_lease_expires_at: null,
      created_at: "2026-03-06T10:30:00.000Z",
      retry_count: 0,
      tenant_id: TENANT_ID,
    },
    {
      id: JOB_B_ID,
      project_id: PROJECT_ID,
      estimate_version_id: VERSION_ID,
      source_file_name: "cvc-b.pdf",
      source_file_type: "application/pdf",
      level: "A",
      status: "applied",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_batch_updated_at: null,
      provider_reconcile_due_at: null,
      provider_reconcile_lease_expires_at: null,
      created_at: "2026-03-06T09:30:00.000Z",
      retry_count: 0,
      tenant_id: TENANT_ID,
    },
    {
      id: JOB_C_ID,
      project_id: PROJECT_ID,
      estimate_version_id: VERSION_ID,
      source_file_name: "manual-upload.xlsx",
      source_file_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      level: "A",
      status: "processing",
      processing_strategy: "batch",
      provider_batch_id: "batch-job-c",
      provider_batch_state: "running",
      provider_batch_updated_at: "2026-03-06T08:31:00.000Z",
      provider_reconcile_due_at: null,
      provider_reconcile_lease_expires_at: null,
      created_at: "2026-03-06T08:30:00.000Z",
      retry_count: 0,
      tenant_id: TENANT_ID,
    },
  ];

  const planSets = [
    {
      id: PLAN_SET_A_ID,
      name: "Plans architecte - Lot CVC",
      metadata: { lotLabel: "CVC" },
      estimate_version_id: VERSION_ID,
      created_at: "2026-03-05T09:00:00.000Z",
      project_id: PROJECT_ID,
      tenant_id: TENANT_ID,
    },
    {
      id: PLAN_SET_B_ID,
      name: "Plans execution - Lot CVC",
      metadata: { lotLabel: "CVC" },
      estimate_version_id: null,
      created_at: "2026-03-04T09:00:00.000Z",
      project_id: PROJECT_ID,
      tenant_id: TENANT_ID,
    },
  ];

  const planFiles = [
    {
      plan_set_id: PLAN_SET_A_ID,
      file_name: "cvc-a.pdf",
      created_at: "2026-03-05T10:00:00.000Z",
      tenant_id: TENANT_ID,
    },
    {
      plan_set_id: PLAN_SET_B_ID,
      file_name: "cvc-b.pdf",
      created_at: "2026-03-04T10:00:00.000Z",
      tenant_id: TENANT_ID,
    },
  ];

  for (const job of takeoffJobs) Object.assign(job, input?.jobPatches?.[job.id]);
  const jobs: QueryRow[] = input?.jobs ?? takeoffJobs;
  for (const file of planFiles) Object.assign(file, input?.planFilePatches?.[file.plan_set_id]);

  const reviewDecisions = [
    { takeoff_job_id: JOB_A_ID, tenant_id: TENANT_ID },
    { takeoff_job_id: JOB_B_ID, tenant_id: TENANT_ID },
  ];

  const takeoffItems = [
    { id: "item-a1", job_id: JOB_A_ID, tenant_id: TENANT_ID, confidence: 0.92 },
    { id: "item-a2", job_id: JOB_A_ID, tenant_id: TENANT_ID, confidence: 0.88 },
    { id: "item-b1", job_id: JOB_B_ID, tenant_id: TENANT_ID, confidence: 0.74 },
  ];

  const dpgfLinks = [
    {
      takeoff_job_id: JOB_A_ID,
      version_id: VERSION_ID,
      estimate_item_id: "estimate-line-1",
      tenant_id: TENANT_ID,
    },
    {
      takeoff_job_id: JOB_A_ID,
      version_id: VERSION_ID,
      estimate_item_id: "estimate-line-1",
      tenant_id: TENANT_ID,
    },
    {
      takeoff_job_id: JOB_B_ID,
      version_id: VERSION_ID,
      estimate_item_id: "estimate-line-2",
      tenant_id: TENANT_ID,
    },
  ];

  const versionLinks = [
    {
      takeoff_job_id: JOB_B_ID,
      linked_from_version_id: "99999999-9999-4999-8999-999999999999",
      tenant_id: TENANT_ID,
    },
  ];

  const estimateItems = input?.estimateItems ?? [
    {
      id: "estimate-line-1",
      version_id: VERSION_ID,
      item_type: "line" as const,
      tenant_id: TENANT_ID,
    },
    {
      id: "estimate-line-2",
      version_id: VERSION_ID,
      item_type: "line" as const,
      tenant_id: TENANT_ID,
    },
    {
      id: "estimate-section-1",
      version_id: VERSION_ID,
      item_type: "section" as const,
      tenant_id: TENANT_ID,
    },
  ];

  return {
    rpc: vi.fn(async (name: string) => {
      if (name !== "list_affaire_takeoff_completions") throw new Error(`Unexpected RPC: ${name}`);
      return { data: input?.director ? [{ event_id: EVENT_ID, outcome: "success", finished_at: FINISHED_AT }] : [], error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === "estimate_projects") {
        return { select: vi.fn(() => createSelectBuilder([
          { id: PROJECT_ID, tenant_id: TENANT_ID, user_id: input?.projectOwner ?? "owner", is_archived: input?.archived ?? false },
        ])) };
      }
      if (table === "estimate_versions") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(versions, options)
          ),
        };
      }

      if (table === "takeoff_jobs") {
        return {
          select: vi.fn((columns?: string, options?: SelectOptions) => columns?.includes("(count)")
            ? createSelectBuilder((input?.director ? [] : jobs).map((job) => ({ id: job.id, tenant_id: job.tenant_id,
              items: [{ count: (input?.itemCounts ?? {})[String(job.id)] ?? takeoffItems.filter((item) => item.job_id === job.id).length }] })))
            : createSelectBuilder(input?.director ? [] : jobs, options)
          ),
        };
      }

      if (table === "plan_sets") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(planSets, options)
          ),
        };
      }

      if (table === "plan_files") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(planFiles, options)
          ),
        };
      }

      if (table === "takeoff_results") {
        return { select: vi.fn(() => createSelectBuilder([])) };
      }

      if (table === "takeoff_dpgf_review_decisions") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(reviewDecisions, options)
          ),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(takeoffItems, options)
          ),
        };
      }

      if (table === "takeoff_dpgf_links") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(dpgfLinks, options)
          ),
        };
      }

      if (table === "takeoff_version_links") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(versionLinks, options)
          ),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(estimateItems, options)
          ),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("listActivityCenterJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: createSupabaseMock() as never,
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
  });

  it("returns just the shared end when a non-owner director cannot read the job", async () => {
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID, tenantRole: "director", userId: "director", supabase: createSupabaseMock({ director: true }),
    } as never);
    const response = await listActivityCenterJobs({ project_id: PROJECT_ID });
    expect(response.jobs).toEqual([]);
    expect(response).toMatchObject({ analysisCompletions: [
      { eventId: EVENT_ID, outcome: "success", finishedAt: FINISHED_AT },
    ] });
  });

  it("refuses to load even the shared end after the affaire is archived", async () => {
    const supabase = createSupabaseMock({ director: true, archived: true });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID, tenantRole: "director", userId: "director", supabase,
    } as never);
    await expect(listActivityCenterJobs({ project_id: PROJECT_ID })).rejects.toMatchObject({ status: 404 });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("computes blocking counters from the full filtered result set, not only the current page", async () => {
    const response = await listActivityCenterJobs({
      project_id: PROJECT_ID,
      limit: 1,
      offset: 0,
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]?.jobId).toBe(JOB_A_ID);
    expect(response.pagination).toEqual({
      limit: 1,
      offset: 0,
      total: 3,
    });
    expect(response.counters).toEqual({
      technicalJobs: 1,
      usableJobs: 2,
      blockingExceptionsJobs: 2,
    });
  });

  it("applies lot and plan-set source filters before paginating rows", async () => {
    const response = await listActivityCenterJobs({
      project_id: PROJECT_ID,
      lot: "CVC",
      planSetId: PLAN_SET_A_ID,
      limit: 20,
      offset: 0,
    });

    expect(response.pagination.total).toBe(1);
    expect(response.counters).toEqual({
      technicalJobs: 0,
      usableJobs: 1,
      blockingExceptionsJobs: 1,
    });
    expect(response.jobs).toEqual([
      expect.objectContaining({
        jobId: JOB_A_ID,
        lotLabel: "CVC",
        planSetLabel: "Plans architecte - Lot CVC",
        versionLabel: "V3",
        statusRaw: "review_required",
      }),
    ]);
  });

  // M1b : un job de jeu de plans porte le libellé d'origine (« CVC A (R+1).pdf ») et son jeu ; le
  // fichier garde le nom nettoyé pour Storage, partagé par R+1 et R-1. Le jeu du job fait foi.
  it("resolves a plan-set job by its plan set, never by the sanitized file name", async () => {
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: createSupabaseMock({
        jobPatches: {
          [JOB_A_ID]: { plan_set_id: PLAN_SET_A_ID, source_file_name: "CVC A (R+1).pdf" },
          [JOB_B_ID]: { plan_set_id: PLAN_SET_B_ID, source_file_name: "CVC-A-R-1-.pdf" },
        },
        planFilePatches: { [PLAN_SET_A_ID]: { file_name: "CVC-A-R-1-.pdf" } },
      }) as never,
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);

    const filtered = await listActivityCenterJobs({
      project_id: PROJECT_ID,
      planSetId: PLAN_SET_A_ID,
      limit: 20,
      offset: 0,
    });
    expect(filtered.jobs.map((job) => [job.jobId, job.planSetLabel])).toEqual([
      [JOB_A_ID, "Plans architecte - Lot CVC"],
    ]);

    const all = await listActivityCenterJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 });
    expect(all.jobs.map((job) => [job.jobId, job.planSetLabel])).toEqual([
      [JOB_A_ID, "Plans architecte - Lot CVC"],
      [JOB_B_ID, "Plans execution - Lot CVC"],
      [JOB_C_ID, null],
    ]);
  });

  it("computes coverage from unique linked DPGF lines only", async () => {
    const response = await listActivityCenterJobs({
      project_id: PROJECT_ID,
      limit: 20,
      offset: 0,
    });

    expect(response.jobs.find((job) => job.jobId === JOB_A_ID)?.coveragePercent).toBe(50);
    expect(response.jobs.find((job) => job.jobId === JOB_B_ID)?.coveragePercent).toBe(50);
    expect(response.jobs.find((job) => job.jobId === JOB_C_ID)?.coveragePercent).toBeNull();
  });

  it("returns no coverage when the target version has no DPGF line", async () => {
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: createSupabaseMock({
        estimateItems: [
          {
            id: "estimate-section-1",
            version_id: VERSION_ID,
            item_type: "section",
            tenant_id: TENANT_ID,
          },
        ],
      }) as never,
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);

    const response = await listActivityCenterJobs({
      project_id: PROJECT_ID,
      limit: 20,
      offset: 0,
    });

    expect(response.jobs.find((job) => job.jobId === JOB_A_ID)?.coveragePercent).toBeNull();
    expect(response.jobs.find((job) => job.jobId === JOB_B_ID)?.coveragePercent).toBeNull();
  });

  it("includes affaire-only jobs and excludes them when a version is selected", async () => {
    const supabase = createSupabaseMock({
      jobPatches: { [JOB_C_ID]: { estimate_version_id: null, plan_set_id: PLAN_SET_B_ID, status: "completed" } },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase, tenantId: TENANT_ID, tenantRole: "admin",
    } as never);

    const all = await listActivityCenterJobs({ project_id: PROJECT_ID });
    const version = await listActivityCenterJobs({ project_id: PROJECT_ID, versionId: VERSION_ID });

    expect(all.jobs.find(job => job.jobId === JOB_C_ID)).toMatchObject({
      estimateVersionId: null, versionLabel: "Sans devis", coveragePercent: null,
    });
    expect(version.jobs.map(job => job.jobId)).toEqual([JOB_A_ID, JOB_B_ID]);
  });

  it("filters jobs by visible status instead of the raw database status", async () => {
    const response = await listActivityCenterJobs({
      project_id: PROJECT_ID,
      status: "review_required",
      limit: 20,
      offset: 0,
    });

    expect(response.jobs).toHaveLength(2);
    expect(response.jobs.map((job) => job.jobId)).toEqual([JOB_A_ID, JOB_B_ID]);
    expect(response.jobs.every((job) => job.statusRaw === "review_required")).toBe(true);
  });
});

describe("listActivityCenterJobs: the resume of stopped analyses", () => {
  const MEMBER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
  const THIS_MAC = "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ids = Array.from({ length: 7 }, (_, index) => `bbbbbbbb-0000-4000-8000-00000000000${index + 1}`);

  /** A whole row, as the detail reads it too. */
  function stoppedJob(index: number, patch: QueryRow = {}): QueryRow {
    return {
      id: ids[index], tenant_id: TENANT_ID, project_id: PROJECT_ID, estimate_version_id: VERSION_ID, plan_set_id: null,
      source_file_name: `plan-${index}.pdf`, source_file_type: "application/pdf", source_file_size_bytes: 20, level: "C",
      status: "failed", processing_strategy: "sync", provider_batch_id: null, provider_batch_state: null, provider_batch_updated_at: null,
      provider_reconcile_due_at: null, provider_reconcile_attempt_count: 0, provider_reconcile_lease_expires_at: null,
      prompt_version: null, schema_version: null, model: null, thinking_level: null, media_resolution: null,
      retry_count: 0, error_code: "AI_PROVIDER", error_message: "Raw provider text", next_retry_at: null,
      last_error_at: "2026-11-20T07:00:00.000Z", analysis_outcome: null, analysis_finished_at: null, analysis_completion_event_id: null,
      execution_provider: "chatgpt_local", execution_host_id: THIS_MAC, created_by: MEMBER_ID,
      dispatch_status: null, dispatch_outcome: null, dispatch_trigger: null, dispatch_correlation_id: null, dispatch_status_code: null,
      dispatch_updated_at: null, token_count: null, cost_cents: null, duration_ms: null, started_at: "2026-11-20T06:59:00.000Z",
      completed_at: "2026-11-20T07:00:00.000Z", created_at: `2026-11-20T0${index}:00:00.000Z`, updated_at: "2026-11-20T07:00:00.000Z",
      ...patch,
    };
  }

  const cases: Array<[QueryRow, { action: string; reason: string; availableAt: string | null }, string | null]> = [
    [{}, { action: "retry_now", reason: "retry_available", availableAt: null }, "AI_PROVIDER"],
    [{ analysis_outcome: "failure", analysis_finished_at: FINISHED_AT, analysis_completion_event_id: EVENT_ID },
      { action: "new_analysis", reason: "analysis_closed", availableAt: null }, "AI_PROVIDER"],
    [{ execution_provider: "gemini", execution_host_id: null }, { action: "new_analysis", reason: "legacy_provider", availableAt: null }, "AI_PROVIDER"],
    [{ error_code: "AI_TIMEOUT", next_retry_at: "2099-01-01T00:00:00.000Z" },
      { action: "wait_retry", reason: "retry_scheduled", availableAt: "2099-01-01T00:00:00.000Z" }, "AI_TIMEOUT"],
    // A row the previous application version wrote: no diagnostic, no end date, no recorded end.
    [{ error_code: null, error_message: null, completed_at: null, started_at: null },
      { action: "retry_now", reason: "retry_available", availableAt: null }, null],
    [{ error_code: "SOME_FUTURE_CODE" }, { action: "retry_now", reason: "retry_available", availableAt: null }, "SOME_FUTURE_CODE"],
    [{ status: "canceled", error_code: null, analysis_outcome: "canceled", analysis_finished_at: FINISHED_AT },
      { action: "new_analysis", reason: "analysis_closed", availableAt: null }, null],
  ];

  function signIn(supabase: ReturnType<typeof createSupabaseMock>, tenantRole = "engineer") {
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID, tenantRole, userId: MEMBER_ID, supabase,
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("decides each failed analysis from the rows it already loaded, without a read per analysis", async () => {
    const supabase = createSupabaseMock({ jobs: cases.map(([patch], index) => stoppedJob(index, patch)), projectOwner: MEMBER_ID });
    signIn(supabase);

    const response = await listActivityCenterJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 });

    expect(Object.fromEntries(response.jobs.map((job) => [job.jobId, [job.resume, job.errorCode, job.canResubmit]])))
      .toEqual(Object.fromEntries(cases.map(([, resume, errorCode], index) =>
        [ids[index], [resume, errorCode, resume.action === "retry_now"]])));
    // The jobs and the grouped count of their lines (fix round 1): two reads, whatever the number of rows.
    const tables = supabase.from.mock.calls.map(([table]) => table);
    expect(tables.filter((table) => table === "takeoff_jobs")).toHaveLength(2);
    expect(tables.filter((table) => table === "takeoff_items")).toHaveLength(0);
    expect(tables.filter((table) => table === "estimate_projects")).toHaveLength(1);
    expect(tables).not.toContain("takeoff_results");
  });

  it.each(["engineer", "director", "viewer"])("gives every row the decision of its detail for a member who is %s", async (tenantRole) => {
    const supabase = createSupabaseMock({ jobs: cases.map(([patch], index) => stoppedJob(index, patch)), projectOwner: MEMBER_ID });
    signIn(supabase, tenantRole);

    const response = await listActivityCenterJobs({ project_id: PROJECT_ID, limit: 20, offset: 0 });
    for (const row of response.jobs) {
      const { job } = await getTakeoffJobDetails(row.jobId, {});
      expect(row.resume, row.jobId).toBeDefined();
      expect(job.resume, row.jobId).toEqual({ action: row.resume!.action, reason: row.resume!.reason, available_at: row.resume!.availableAt });
      expect(job.can_resubmit, row.jobId).toBe(row.canResubmit);
      expect(job.can_cancel, row.jobId).toBe(row.canCancel);
    }
    if (tenantRole !== "engineer") expect(response.jobs.some((job) => job.canResubmit)).toBe(false);
  });

  it("answers the contract published in OpenAPI, for stopped and other analyses", async () => {
    signIn(createSupabaseMock({ jobs: cases.map(([patch], index) => stoppedJob(index, patch)), projectOwner: MEMBER_ID }));
    const stopped = await listActivityCenterJobs({ project_id: PROJECT_ID });
    signIn(createSupabaseMock({ projectOwner: MEMBER_ID }));
    const others = await listActivityCenterJobs({ project_id: PROJECT_ID });

    for (const response of [stopped, others]) {
      expect(takeoffActivityCenterResponseSchema.safeParse(response).error?.issues).toBeUndefined();
    }
    expect(others.jobs.map((job) => job.resume?.reason)).toEqual(["not_stopped", "not_stopped", "not_stopped"]);
  });

  // Fix round 1, point 6: two pages of line rows can add up to a count that never existed (a line of A gone, one of B
  // come between the pages, C read as 0). The counts of a page come from one statement, never from line rows.
  it("counts the lines of a page with one grouped read, never from line rows", async () => {
    const supabase = createSupabaseMock({ jobs: [stoppedJob(0), stoppedJob(1), stoppedJob(2)], projectOwner: MEMBER_ID,
      itemCounts: { [ids[0]]: 500, [ids[1]]: 0, [ids[2]]: 1 } });
    signIn(supabase);

    const response = await listActivityCenterJobs({ project_id: PROJECT_ID });
    expect(Object.fromEntries(response.jobs.map((job) => [job.jobId, job.itemCount])))
      .toEqual({ [ids[0]]: 500, [ids[1]]: 0, [ids[2]]: 1 });
    const itemReads = supabase.from.mock.calls.filter(([table]) => table === "takeoff_items");
    expect(itemReads).toHaveLength(0);
  });

  it("reads the member's ChatGPT connection once for every row, and tells the launcher to reconnect", async () => {
    vi.mocked(readChatGptStore).mockResolvedValueOnce({ selectedId: null, profiles: [] } as never);
    const supabase = createSupabaseMock({ jobs: [stoppedJob(0), stoppedJob(5)], projectOwner: MEMBER_ID });
    signIn(supabase);

    const response = await listActivityCenterJobs({ project_id: PROJECT_ID });
    expect(response.jobs.map((job) => job.resume)).toEqual([
      { action: "none", reason: "plan_disconnected", availableAt: null }, { action: "none", reason: "plan_disconnected", availableAt: null },
    ]);
    expect(readChatGptStore).toHaveBeenCalledTimes(1);
  });

  it("offers nothing but a new analysis to an operator who did not launch the job", async () => {
    const supabase = createSupabaseMock({ jobs: [stoppedJob(0, { created_by: "cccccccc-0000-4000-8000-000000000001" })] });
    signIn(supabase, "admin");

    const [row] = (await listActivityCenterJobs({ project_id: PROJECT_ID })).jobs;
    expect(row).toMatchObject({ canResubmit: false, resume: { action: "new_analysis", reason: "launched_by_other" } });
  });
});
