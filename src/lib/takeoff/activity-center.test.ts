import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
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

function createSupabaseMock() {
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
      estimate_version_id: VERSION_ID,
      source_file_name: "cvc-a.pdf",
      source_file_type: "application/pdf",
      level: "A",
      status: "completed",
      created_at: "2026-03-06T10:30:00.000Z",
      retry_count: 0,
      tenant_id: TENANT_ID,
    },
    {
      id: JOB_B_ID,
      estimate_version_id: VERSION_ID,
      source_file_name: "cvc-b.pdf",
      source_file_type: "application/pdf",
      level: "A",
      status: "applied",
      created_at: "2026-03-06T09:30:00.000Z",
      retry_count: 0,
      tenant_id: TENANT_ID,
    },
    {
      id: JOB_C_ID,
      estimate_version_id: VERSION_ID,
      source_file_name: "manual-upload.xlsx",
      source_file_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      level: "A",
      status: "processing",
      processing_strategy: "batch",
      provider_batch_state: "running",
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
    { takeoff_job_id: JOB_A_ID, version_id: VERSION_ID, tenant_id: TENANT_ID },
    { takeoff_job_id: JOB_B_ID, version_id: VERSION_ID, tenant_id: TENANT_ID },
  ];

  const versionLinks = [
    {
      takeoff_job_id: JOB_B_ID,
      linked_from_version_id: "99999999-9999-4999-8999-999999999999",
      tenant_id: TENANT_ID,
    },
  ];

  const estimateItems = [
    { estimate_version_id: VERSION_ID, tenant_id: TENANT_ID },
    { estimate_version_id: VERSION_ID, tenant_id: TENANT_ID },
  ];

  return {
    from: vi.fn((table: string) => {
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
            createSelectBuilder(takeoffJobs, options)
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
      supabase: createSupabaseMock() as never,
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
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
      }),
    ]);
  });

  it("exposes provider-facing technical jobs with a business status label", async () => {
    const response = await listActivityCenterJobs({
      project_id: PROJECT_ID,
      limit: 20,
      offset: 0,
    });

    const technicalJob = response.jobs.find((job) => job.jobId === JOB_C_ID);

    expect(technicalJob).toEqual(
      expect.objectContaining({
        jobId: JOB_C_ID,
        statusRaw: "processing",
        statusLabel: "En attente provider",
      })
    );
  });
});
