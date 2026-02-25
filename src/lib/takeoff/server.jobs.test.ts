import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
  assertDraftStatus: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { TakeoffError } from "@/lib/takeoff/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  cancelTakeoffJob,
  getTakeoffJobDetails,
  listTakeoffJobs,
  parseListTakeoffJobsQuery,
  retryTakeoffJob,
} from "@/lib/takeoff/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "99999999-9999-4999-8999-999999999999";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const JOB_ID = "55555555-5555-4555-8555-555555555555";
const JOB_ID_2 = "66666666-6666-4666-8666-666666666666";

type TakeoffJobStoredRow = {
  id: string;
  estimate_version_id: string;
  tenant_id: string;
  status: string;
  level: string;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  source_file_path: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  media_resolution: string | null;
  retry_count: number;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type TakeoffResultStoredRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  extracted_json: unknown;
  warnings: unknown[];
  tables: unknown[];
  provider_meta: Record<string, unknown>;
  raw_response: unknown;
  confidence: number | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

type TakeoffItemStoredRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
  is_excluded: boolean;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseMockOptions = {
  jobs?: TakeoffJobStoredRow[];
  results?: TakeoffResultStoredRow[];
  items?: TakeoffItemStoredRow[];
  auditInsertError?: {
    code: string;
    message: string;
    details?: string | null;
    hint?: string | null;
  } | null;
};

function baseJob(
  input: Partial<TakeoffJobStoredRow> = {}
): TakeoffJobStoredRow {
  const id = input.id ?? JOB_ID;
  const tenantId = input.tenant_id ?? TENANT_ID;

  return {
    id,
    estimate_version_id: input.estimate_version_id ?? VERSION_ID,
    tenant_id: tenantId,
    status: input.status ?? "failed",
    level: input.level ?? "A",
    source_file_name: input.source_file_name ?? "niveau-a.csv",
    source_file_type: input.source_file_type ?? "text/csv",
    source_file_size_bytes: input.source_file_size_bytes ?? 1024,
    source_file_path:
      input.source_file_path ??
      `${tenantId}/${id}/${"a".repeat(64)}-niveau-a.csv`,
    prompt_version: input.prompt_version ?? "takeoff-a-v1",
    schema_version: input.schema_version ?? "v1",
    model: input.model ?? "gemini-2.5-flash",
    thinking_level: input.thinking_level ?? "high",
    media_resolution: input.media_resolution ?? null,
    retry_count: input.retry_count ?? 0,
    token_count: input.token_count ?? 400,
    cost_cents: input.cost_cents ?? 12,
    duration_ms: input.duration_ms ?? 700,
    started_at: input.started_at ?? null,
    completed_at: input.completed_at ?? "2026-02-25T10:00:00.000Z",
    error_code: input.error_code ?? "AI_TIMEOUT",
    error_message: input.error_message ?? "Timed out",
    created_by: input.created_by ?? USER_ID,
    created_at: input.created_at ?? "2026-02-25T09:55:00.000Z",
    updated_at: input.updated_at ?? "2026-02-25T10:00:00.000Z",
  };
}

function baseResult(
  input: Partial<TakeoffResultStoredRow> = {}
): TakeoffResultStoredRow {
  return {
    id: input.id ?? "77777777-7777-4777-8777-777777777777",
    tenant_id: input.tenant_id ?? TENANT_ID,
    job_id: input.job_id ?? JOB_ID,
    extracted_json: input.extracted_json ?? { items: [] },
    warnings: input.warnings ?? [],
    tables: input.tables ?? [],
    provider_meta: input.provider_meta ?? {},
    raw_response: input.raw_response ?? { provider: "gemini" },
    confidence: input.confidence ?? 0.91,
    token_count: input.token_count ?? 450,
    cost_cents: input.cost_cents ?? 13,
    duration_ms: input.duration_ms ?? 800,
    created_at: input.created_at ?? "2026-02-25T10:02:00.000Z",
    updated_at: input.updated_at ?? "2026-02-25T10:02:00.000Z",
  };
}

function baseItem(
  input: Partial<TakeoffItemStoredRow> = {}
): TakeoffItemStoredRow {
  return {
    id: input.id ?? "88888888-8888-4888-8888-888888888888",
    tenant_id: input.tenant_id ?? TENANT_ID,
    job_id: input.job_id ?? JOB_ID,
    designation: input.designation ?? "Tube cuivre",
    quantity: input.quantity ?? 4,
    unit: input.unit ?? "ml",
    confidence: input.confidence ?? 0.8,
    evidence: input.evidence ?? "Ligne 42",
    source_file_name: input.source_file_name ?? "niveau-a.csv",
    source_page: input.source_page ?? 1,
    metadata: input.metadata ?? {},
    is_excluded: input.is_excluded ?? false,
    is_verified: input.is_verified ?? false,
    verified_at: input.verified_at ?? null,
    verified_by: input.verified_by ?? null,
    created_at: input.created_at ?? "2026-02-25T10:02:10.000Z",
    updated_at: input.updated_at ?? "2026-02-25T10:02:10.000Z",
  };
}

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const jobs = options.jobs ?? [baseJob()];
  const results = options.results ?? [baseResult()];
  const items =
    options.items ??
    [
      baseItem({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        created_at: "2026-02-25T10:03:00.000Z",
      }),
      baseItem({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        designation: "Cable U1000",
        created_at: "2026-02-25T10:03:30.000Z",
      }),
    ];
  const auditInsertError = options.auditInsertError ?? null;

  const state = {
    jobsById: new Map(jobs.map((job) => [job.id, { ...job }])),
    resultsByJobId: new Map(
      results.map((result) => [result.job_id, { ...result }])
    ),
    itemsByJobId: new Map<string, TakeoffItemStoredRow[]>(
      Array.from(
        items.reduce((acc, item) => {
          const list = acc.get(item.job_id) ?? [];
          list.push({ ...item });
          acc.set(item.job_id, list);
          return acc;
        }, new Map<string, TakeoffItemStoredRow[]>())
      )
    ),
    auditLogs: [] as Array<Record<string, unknown>>,
  };

  function applyRange<T>(rows: T[], start: number, end: number) {
    return rows.slice(start, end + 1);
  }

  function createTakeoffJobsSelectBuilder() {
    const filters: {
      id?: string;
      tenant_id?: string;
      estimate_version_id?: string;
      status?: string;
      level?: string;
      created_at_gte?: string;
    } = {};
    let range: { start: number; end: number } | null = null;

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (
          column === "id" ||
          column === "tenant_id" ||
          column === "estimate_version_id" ||
          column === "status" ||
          column === "level"
        ) {
          filters[column] = value;
        }
        return builder;
      }),
      gte: vi.fn((column: string, value: string) => {
        if (column === "created_at") {
          filters.created_at_gte = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {
        range = { start, end };
        return builder;
      }),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const rows = [...state.jobsById.values()].filter((row) => {
          if (filters.id && row.id !== filters.id) return false;
          if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
          if (
            filters.estimate_version_id &&
            row.estimate_version_id !== filters.estimate_version_id
          ) {
            return false;
          }
          if (filters.status && row.status !== filters.status) return false;
          if (filters.level && row.level !== filters.level) return false;
          if (
            filters.created_at_gte &&
            row.created_at.localeCompare(filters.created_at_gte) < 0
          ) {
            return false;
          }
          return true;
        });

        return { data: rows[0] ?? null, error: null };
      }),
      then: (
        onFulfilled?: (
          value: {
            data: TakeoffJobStoredRow[];
            count: number;
            error: null;
          }
        ) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const filtered = [...state.jobsById.values()]
          .filter((row) => {
            if (filters.id && row.id !== filters.id) return false;
            if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
            if (
              filters.estimate_version_id &&
              row.estimate_version_id !== filters.estimate_version_id
            ) {
              return false;
            }
            if (filters.status && row.status !== filters.status) return false;
            if (filters.level && row.level !== filters.level) return false;
            if (
              filters.created_at_gte &&
              row.created_at.localeCompare(filters.created_at_gte) < 0
            ) {
              return false;
            }
            return true;
          })
          .sort((a, b) => b.created_at.localeCompare(a.created_at));

        const data = range
          ? applyRange(filtered, range.start, range.end)
          : filtered;

        return Promise.resolve({
          data,
          count: filtered.length,
          error: null,
        }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  function createTakeoffJobsUpdateBuilder(payload: Partial<TakeoffJobStoredRow>) {
    const filters: { id?: string; tenant_id?: string; status?: string } = {};
    let statuses: string[] | null = null;

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "id" || column === "tenant_id" || column === "status") {
          filters[column] = value;
        }
        return builder;
      }),
      in: vi.fn((column: string, values: string[]) => {
        if (column === "status") {
          statuses = values;
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const candidate = [...state.jobsById.values()].find((row) => {
          if (filters.id && row.id !== filters.id) return false;
          if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
          if (filters.status && row.status !== filters.status) return false;
          if (statuses && !statuses.includes(row.status)) return false;
          return true;
        });

        if (!candidate) {
          return { data: null, error: null };
        }

        const updated: TakeoffJobStoredRow = {
          ...candidate,
          ...payload,
          updated_at: "2026-02-25T11:00:00.000Z",
        };
        state.jobsById.set(updated.id, updated);
        return { data: updated, error: null };
      }),
    };

    return builder;
  }

  function createTakeoffResultsSelectBuilder() {
    const filters: { tenant_id?: string; job_id?: string } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "job_id") {
          filters[column] = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const row = filters.job_id
          ? state.resultsByJobId.get(filters.job_id) ?? null
          : null;

        if (!row) {
          return { data: null, error: null };
        }

        if (filters.tenant_id && row.tenant_id !== filters.tenant_id) {
          return { data: null, error: null };
        }

        return { data: row, error: null };
      }),
    };

    return builder;
  }

  function createTakeoffItemsSelectBuilder() {
    const filters: { tenant_id?: string; job_id?: string } = {};
    let range: { start: number; end: number } | null = null;

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "job_id") {
          filters[column] = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {
        range = { start, end };
        return builder;
      }),
      then: (
        onFulfilled?: (
          value: {
            data: TakeoffItemStoredRow[];
            count: number;
            error: null;
          }
        ) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const jobItems = filters.job_id
          ? state.itemsByJobId.get(filters.job_id) ?? []
          : [];
        const filtered = jobItems
          .filter((item) => !filters.tenant_id || item.tenant_id === filters.tenant_id)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));

        const data = range
          ? applyRange(filtered, range.start, range.end)
          : filtered;

        return Promise.resolve({
          data,
          count: filtered.length,
          error: null,
        }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const supabase = {
    __state: state,
    from: vi.fn((table: string) => {
      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => createTakeoffJobsSelectBuilder()),
          update: vi.fn((payload: Partial<TakeoffJobStoredRow>) =>
            createTakeoffJobsUpdateBuilder(payload)
          ),
        };
      }

      if (table === "takeoff_results") {
        return {
          select: vi.fn(() => createTakeoffResultsSelectBuilder()),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn(() => createTakeoffItemsSelectBuilder()),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            if (auditInsertError) {
              return { data: null, error: auditInsertError };
            }

            state.auditLogs.push(payload);
            return { data: null, error: null };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return supabase;
}

describe("takeoff job server helpers (TKF-009)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("validates list query payload", () => {
    expect(() =>
      parseListTakeoffJobsQuery({
        estimate_version_id: "not-a-uuid",
      })
    ).toThrowError();
  });

  it("lists jobs filtered by tenant and estimate version with pagination", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          id: JOB_ID,
          estimate_version_id: VERSION_ID,
          created_at: "2026-02-25T10:00:00.000Z",
        }),
        baseJob({
          id: JOB_ID_2,
          estimate_version_id: OTHER_VERSION_ID,
          status: "pending",
          created_at: "2026-02-25T09:00:00.000Z",
          error_code: null,
          error_message: null,
        }),
        baseJob({
          id: "77777777-7777-4777-8777-777777777770",
          tenant_id: OTHER_TENANT_ID,
          estimate_version_id: VERSION_ID,
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await listTakeoffJobs({
      estimate_version_id: VERSION_ID,
      limit: 10,
      offset: 0,
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]?.id).toBe(JOB_ID);
    expect(response.jobs[0]?.items_count).toBe(2);
    expect(response.jobs[0]?.metrics.token_count).toBe(400);
    expect(response.counters).toEqual({
      total: 1,
      processing: 0,
      completed: 0,
      failed: 1,
      canceled: 0,
    });
    expect(response.pagination).toEqual({
      limit: 10,
      offset: 0,
      total: 1,
    });
  });

  it("filters jobs by status level and period while keeping status counters scoped by base filters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T12:00:00.000Z"));

    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          id: JOB_ID,
          status: "failed",
          level: "A",
          created_at: "2026-02-24T10:00:00.000Z",
        }),
        baseJob({
          id: JOB_ID_2,
          status: "processing",
          level: "A",
          error_code: null,
          error_message: null,
          completed_at: null,
          created_at: "2026-02-22T10:00:00.000Z",
        }),
        baseJob({
          id: "77777777-7777-4777-8777-777777777771",
          status: "completed",
          level: "B",
          error_code: null,
          error_message: null,
          created_at: "2026-02-21T10:00:00.000Z",
        }),
        baseJob({
          id: "77777777-7777-4777-8777-777777777772",
          status: "canceled",
          level: "A",
          error_code: "USER_CANCELED",
          created_at: "2026-01-01T10:00:00.000Z",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await listTakeoffJobs({
      status: "failed",
      level: "A",
      period: "30d",
      limit: 20,
      offset: 0,
    });

    expect(response.jobs).toHaveLength(1);
    expect(response.jobs[0]?.id).toBe(JOB_ID);
    expect(response.counters).toEqual({
      total: 2,
      processing: 1,
      completed: 0,
      failed: 1,
      canceled: 0,
    });
    expect(response.pagination.total).toBe(1);
  });

  it("returns job detail with paginated items and result", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const detail = await getTakeoffJobDetails(JOB_ID, {
      items_limit: 1,
      items_offset: 1,
    });

    expect(detail.job.id).toBe(JOB_ID);
    expect(detail.result?.id).toBe("77777777-7777-4777-8777-777777777777");
    expect(detail.items.data).toHaveLength(1);
    expect(detail.items.data[0]?.designation).toBe("Cable U1000");
    expect(detail.items.pagination).toEqual({
      limit: 1,
      offset: 1,
      total: 2,
    });
  });

  it("retries only failed jobs and updates retry count", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 1,
          completed_at: "2026-02-25T08:00:00.000Z",
          error_code: "AI_TIMEOUT",
          error_message: "Timed out",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await retryTakeoffJob(JOB_ID);

    expect(response.job.status).toBe("pending");
    expect(response.job.retry_count).toBe(2);
    expect(response.job.error_code).toBeNull();
    expect(response.job.metrics.token_count).toBeNull();
    expect(supabase.__state.auditLogs).toHaveLength(1);
    expect(supabase.__state.auditLogs[0]?.action).toBe("takeoff.job.retried");
  });

  it("blocks retry when status is not failed", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "pending",
          retry_count: 0,
          error_code: null,
          error_message: null,
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    await expect(retryTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("blocks retry when max retries is reached", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 3,
          completed_at: "2026-02-25T08:00:00.000Z",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    await expect(retryTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("enforces retry backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T10:00:10.000Z"));

    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 1,
          completed_at: "2026-02-25T10:00:00.000Z",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    await expect(retryTakeoffJob(JOB_ID)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("returns success when retry audit insert fails after status mutation", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "failed",
          retry_count: 1,
          completed_at: "2026-02-25T08:00:00.000Z",
        }),
      ],
      auditInsertError: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: null,
        hint: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await retryTakeoffJob(JOB_ID);

    expect(response.job.status).toBe("pending");
    expect(response.job.retry_count).toBe(2);
    expect(supabase.__state.jobsById.get(JOB_ID)?.status).toBe("pending");
    expect(supabase.__state.auditLogs).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Takeoff audit logging failed (non-blocking)",
      expect.objectContaining({
        action: "takeoff.job.retried",
        tenantId: TENANT_ID,
        jobId: JOB_ID,
      })
    );

    consoleErrorSpy.mockRestore();
  });

  it("cancels pending jobs and logs audit event", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "pending",
          retry_count: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await cancelTakeoffJob(JOB_ID);

    expect(response.job.status).toBe("canceled");
    expect(supabase.__state.auditLogs).toHaveLength(1);
    expect(supabase.__state.auditLogs[0]?.action).toBe("takeoff.job.canceled");
  });

  it("returns success when cancel audit insert fails after status mutation", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "pending",
          retry_count: 0,
          completed_at: null,
          error_code: null,
          error_message: null,
        }),
      ],
      auditInsertError: {
        code: "23505",
        message: "duplicate key value violates unique constraint",
        details: null,
        hint: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    const response = await cancelTakeoffJob(JOB_ID);

    expect(response.job.status).toBe("canceled");
    expect(supabase.__state.jobsById.get(JOB_ID)?.status).toBe("canceled");
    expect(supabase.__state.auditLogs).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Takeoff audit logging failed (non-blocking)",
      expect.objectContaining({
        action: "takeoff.job.canceled",
        tenantId: TENANT_ID,
        jobId: JOB_ID,
      })
    );

    consoleErrorSpy.mockRestore();
  });

  it("returns conflict when canceling a terminal job", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        baseJob({
          status: "completed",
          retry_count: 1,
          error_code: null,
          error_message: null,
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);

    let thrown: unknown;
    try {
      await cancelTakeoffJob(JOB_ID);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TakeoffError);
    expect(thrown).toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });
});
