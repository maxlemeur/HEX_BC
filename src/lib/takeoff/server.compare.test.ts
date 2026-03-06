import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
  assertDraftStatus: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { TakeoffError } from "@/lib/takeoff/errors";
import {
  compareTakeoffJobs,
  parseCompareTakeoffJobsQuery,
} from "@/lib/takeoff/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_JOB_ID = "55555555-5555-4555-8555-555555555555";

type StoredJob = {
  id: string;
  tenant_id: string;
  estimate_version_id: string;
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
  next_retry_at: string | null;
  last_error_at: string | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

type StoredItem = {
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
  exclusion_reason: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

function makeJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    estimate_version_id: VERSION_ID,
    status: "completed",
    level: "A",
    source_file_name: "plan-rev-a.pdf",
    source_file_type: "application/pdf",
    source_file_size_bytes: 1024,
    source_file_path: `${TENANT_ID}/${JOB_ID}/plan.pdf`,
    prompt_version: "takeoff-a-v1",
    schema_version: "v1",
    model: "gemini-3-flash-preview",
    thinking_level: "high",
    media_resolution: null,
    retry_count: 0,
    next_retry_at: null,
    last_error_at: null,
    token_count: 120,
    cost_cents: 4,
    duration_ms: 1000,
    started_at: "2026-02-25T10:00:00.000Z",
    completed_at: "2026-02-25T10:00:01.000Z",
    error_code: null,
    error_message: null,
    created_at: "2026-02-25T09:59:00.000Z",
    updated_at: "2026-02-25T10:00:01.000Z",
    created_by: USER_ID,
    ...overrides,
  };
}

function makeItem(overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    tenant_id: TENANT_ID,
    job_id: JOB_ID,
    designation: "Cable U1000",
    quantity: 8,
    unit: "ml",
    confidence: 0.82,
    evidence: null,
    source_file_name: "plan-rev-a.pdf",
    source_page: 3,
    metadata: {},
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T10:00:02.000Z",
    updated_at: "2026-02-25T10:00:02.000Z",
    ...overrides,
  };
}

function createSupabaseMock(input?: {
  jobs?: StoredJob[];
  items?: StoredItem[];
}) {
  const jobs = input?.jobs ?? [makeJob(), makeJob({ id: OTHER_JOB_ID })];
  const items =
    input?.items ??
    [
      makeItem({
        id: "77777777-7777-4777-8777-777777777777",
        job_id: JOB_ID,
        designation: "Cable U1000",
        quantity: 8,
      }),
      makeItem({
        id: "88888888-8888-4888-8888-888888888888",
        job_id: OTHER_JOB_ID,
        designation: "Cable U1000",
        quantity: 10,
      }),
      makeItem({
        id: "99999999-9999-4999-8999-999999999999",
        job_id: OTHER_JOB_ID,
        designation: "Tube PVC",
        quantity: 2,
      }),
    ];

  const state = {
    jobs,
    items,
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              maybeSingle: vi.fn(async () => {
                const row =
                  state.jobs.find(
                    (job) =>
                      (!filters.tenant_id || job.tenant_id === filters.tenant_id) &&
                      (!filters.id || job.id === filters.id)
                  ) ?? null;

                return { data: row, error: null };
              }),
            };

            return builder;
          }),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            let rangeStart = 0;
            let rangeEnd = 0;

            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              range: vi.fn(async (start: number, end: number) => {
                rangeStart = start;
                rangeEnd = end;

                const rows = state.items.filter(
                  (item) =>
                    (!filters.tenant_id || item.tenant_id === filters.tenant_id) &&
                    (!filters.job_id || item.job_id === filters.job_id)
                );

                return {
                  data: rows.slice(rangeStart, rangeEnd + 1),
                  count: rows.length,
                  error: null,
                };
              }),
            };

            return builder;
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return supabase;
}

describe("compareTakeoffJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("compares two jobs from the same document", async () => {
    const supabase = createSupabaseMock();

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const parsedQuery = parseCompareTakeoffJobsQuery({
      with: OTHER_JOB_ID,
      threshold: "0.8",
    });

    const response = await compareTakeoffJobs(JOB_ID, parsedQuery);

    expect(response.base_job_id).toBe(JOB_ID);
    expect(response.other_job_id).toBe(OTHER_JOB_ID);
    expect(response.summary.added).toBe(1);
    expect(response.summary.changed).toBe(1);
    expect(response.summary.total_base).toBe(1);
    expect(response.summary.total_other).toBe(2);
  });

  it("returns 409 when jobs are not from the same document", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        makeJob({ id: JOB_ID, source_file_name: "plan-a.pdf" }),
        makeJob({
          id: OTHER_JOB_ID,
          source_file_name: "plan-b.pdf",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const parsedQuery = parseCompareTakeoffJobsQuery({
      with: OTHER_JOB_ID,
    });

    await expect(compareTakeoffJobs(JOB_ID, parsedQuery)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("returns 404 when target job is outside tenant scope", async () => {
    const supabase = createSupabaseMock({
      jobs: [
        makeJob({ id: JOB_ID, tenant_id: TENANT_ID }),
        makeJob({
          id: OTHER_JOB_ID,
          tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      ],
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const parsedQuery = parseCompareTakeoffJobsQuery({
      with: OTHER_JOB_ID,
    });

    const error = await compareTakeoffJobs(JOB_ID, parsedQuery).catch(
      (caught) => caught
    );

    expect(error).toBeInstanceOf(TakeoffError);
    expect((error as TakeoffError).status).toBe(404);
  });
});
