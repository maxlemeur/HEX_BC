import { beforeEach, describe, expect, it, vi } from "vitest";

// Pagination faults are covered with the real SDK in read-all.test.ts.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { listActivityCenterJobs } from "@/lib/takeoff/activity-center";

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
  /** The affaire's shared ends, newest first, with the job each one ended. */
  completions?: Array<{ event_id: string; outcome: string; finished_at: string; reason_code: string | null; job_id: string }>;
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
    rpc: vi.fn(async (name: string, args: { p_limit?: number; p_offset?: number; p_job_id?: string | null } = {}) => {
      if (name !== "list_affaire_takeoff_completions") throw new Error(`Unexpected RPC: ${name}`);
      if (input?.completions) {
        const offset = args.p_offset ?? 0;
        const rows = input.completions.filter((row) => !args.p_job_id || row.job_id === args.p_job_id)
          .slice(offset, offset + Math.min(args.p_limit ?? 20, 101))
          .map((row) => ({ event_id: row.event_id, outcome: row.outcome, finished_at: row.finished_at, reason_code: row.reason_code }));
        return { data: rows, error: null };
      }
      return { data: input?.director ? [{ event_id: EVENT_ID, outcome: "success", finished_at: FINISHED_AT }] : [], error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === "estimate_projects") {
        return { select: vi.fn(() => createSelectBuilder([
          { id: PROJECT_ID, tenant_id: TENANT_ID, user_id: "owner", is_archived: input?.archived ?? false },
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
          select: vi.fn((_columns?: string, options?: SelectOptions) =>
            createSelectBuilder(input?.director ? [] : takeoffJobs, options)
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
      { eventId: EVENT_ID, outcome: "success", finishedAt: FINISHED_AT, failureReason: null },
    ] });
  });

  it("lists only the job a failure link names, whatever page it would fall on", async () => {
    const all = await listActivityCenterJobs({ project_id: PROJECT_ID, limit: 1 });
    const older = all.jobs[0]?.jobId === JOB_C_ID ? JOB_A_ID : JOB_C_ID;
    const focused = await listActivityCenterJobs({ project_id: PROJECT_ID, limit: 1, jobId: older });
    expect(focused.jobs.map((job) => job.jobId)).toEqual([older]);
    expect(focused.pagination).toMatchObject({ offset: 0, total: 1 });
    // The facts of the page keep counting the whole affaire.
    expect(focused.counters).toEqual(all.counters);
  });

  it("gives a director who cannot read the job its shared end and French reason", async () => {
    const completions = [
      { event_id: EVENT_ID, outcome: "success", finished_at: FINISHED_AT, reason_code: null, job_id: JOB_B_ID },
      { event_id: "99999999-9999-4999-8999-999999999998", outcome: "failure", finished_at: "2026-11-19T08:00:00.000Z",
        reason_code: "AI_PROVIDER", job_id: JOB_A_ID },
    ];
    const supabase = createSupabaseMock({ director: true, completions });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID, tenantRole: "director", userId: "director", supabase,
    } as never);
    const response = await listActivityCenterJobs({ project_id: PROJECT_ID, jobId: JOB_A_ID });
    expect(supabase.rpc).toHaveBeenCalledWith("list_affaire_takeoff_completions", expect.objectContaining({ p_job_id: JOB_A_ID }));
    expect(response.jobs).toEqual([]);
    expect(response.analysisCompletions).toEqual([{ eventId: "99999999-9999-4999-8999-999999999998", outcome: "failure",
      finishedAt: "2026-11-19T08:00:00.000Z", failureReason: "Le service d’analyse n’a pas pu terminer le métré." }]);
  });

  it("pages the shared ends for a reader who sees no job", async () => {
    const completions = ["1", "2", "3"].map((digit, index) => ({
      event_id: `99999999-9999-4999-8999-99999999999${digit}`, outcome: "success",
      finished_at: `2026-11-1${9 - index}T08:00:00.000Z`, reason_code: null, job_id: JOB_A_ID,
    }));
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: TENANT_ID, tenantRole: "director", userId: "director",
      supabase: createSupabaseMock({ director: true, completions }),
    } as never);
    const first = await listActivityCenterJobs({ project_id: PROJECT_ID, limit: 2 });
    expect(first.analysisCompletions.map((event) => event.eventId)).toEqual([completions[0].event_id, completions[1].event_id]);
    expect(first.analysisCompletionsHasOlder).toBe(true);
    const next = await listActivityCenterJobs({ project_id: PROJECT_ID, limit: 2, offset: 2 });
    expect(next.analysisCompletions.map((event) => event.eventId)).toEqual([completions[2].event_id]);
    expect(next.analysisCompletionsHasOlder).toBe(false);
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
