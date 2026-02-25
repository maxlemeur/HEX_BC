import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  assertDraftStatus: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import {
  bulkUpdateEstimateItems,
  getAuthenticatedContext,
} from "@/lib/estimates/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { applyTakeoffJob } from "@/lib/takeoff/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_ITEM_ID = "77777777-7777-4777-8777-777777777777";
const VERSION_UPDATED_AT = "2026-02-25T12:00:00.000Z";

type StoredTakeoffJob = {
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

type SupabaseMockOptions = {
  jobStatus?: string;
  rpcError?: {
    code?: string;
    message?: string;
    details?: string | null;
    hint?: string | null;
  };
};

function baseJob(overrides: Partial<StoredTakeoffJob> = {}): StoredTakeoffJob {
  return {
    id: JOB_ID,
    estimate_version_id: VERSION_ID,
    tenant_id: TENANT_ID,
    status: "completed",
    level: "A",
    source_file_name: "niveau-a.csv",
    source_file_type: "text/csv",
    source_file_size_bytes: 1024,
    source_file_path: `${TENANT_ID}/${JOB_ID}/source.csv`,
    prompt_version: "takeoff-a-v1",
    schema_version: "v1",
    model: "gemini-2.5-flash",
    thinking_level: "high",
    media_resolution: null,
    retry_count: 0,
    next_retry_at: null,
    last_error_at: null,
    token_count: 120,
    cost_cents: 4,
    duration_ms: 5000,
    started_at: "2026-02-25T11:59:00.000Z",
    completed_at: "2026-02-25T12:00:00.000Z",
    error_code: null,
    error_message: null,
    created_at: "2026-02-25T11:58:00.000Z",
    updated_at: "2026-02-25T12:00:00.000Z",
    created_by: USER_ID,
    ...overrides,
  };
}

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const state = {
    job: baseJob({ status: options.jobStatus ?? "completed" }),
    auditActions: [] as string[],
  };

  const supabase = {
    __state: state,
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
                const matchesTenant =
                  !filters.tenant_id || filters.tenant_id === state.job.tenant_id;
                const matchesId = !filters.id || filters.id === state.job.id;

                if (!matchesTenant || !matchesId) {
                  return { data: null, error: null };
                }

                return { data: { ...state.job }, error: null };
              }),
            };

            return builder;
          }),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              maybeSingle: vi.fn(async () => {
                const matchesTenant = filters.tenant_id === TENANT_ID;
                const matchesVersion = filters.id === VERSION_ID;

                if (!matchesTenant || !matchesVersion) {
                  return { data: null, error: null };
                }

                return {
                  data: {
                    id: VERSION_ID,
                    updated_at: VERSION_UPDATED_AT,
                  },
                  error: null,
                };
              }),
            };

            return builder;
          }),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            if (typeof payload.action === "string") {
              state.auditActions.push(payload.action);
            }

            return { data: null, error: null };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(async (fn: string) => {
      if (fn !== "apply_takeoff_job") {
        throw new Error(`Unexpected rpc function: ${fn}`);
      }

      if (options.rpcError) {
        return {
          data: null,
          error: options.rpcError,
        };
      }

      state.job = {
        ...state.job,
        status: "applied",
        updated_at: "2026-02-25T12:01:00.000Z",
      };

      return {
        data: {
          scope: "section",
          created_count: 1,
          updated_count: 0,
          ignored_count: 0,
          created_ids: [CREATED_ITEM_ID],
        },
        error: null,
      };
    }),
  };

  return supabase;
}

describe("applyTakeoffJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("applies a completed job, runs lock precheck and returns job+summary", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    const response = await applyTakeoffJob(JOB_ID, {
      strategy: "merge",
      target_section_id: SECTION_ID,
    });

    expect(vi.mocked(bulkUpdateEstimateItems)).toHaveBeenCalledWith(
      VERSION_ID,
      [],
      VERSION_UPDATED_AT
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "apply_takeoff_job",
      expect.objectContaining({
        p_job_id: JOB_ID,
        p_strategy: "merge",
        p_target_section_id: SECTION_ID,
      })
    );
    expect(response.job.status).toBe("applied");
    expect(response.summary).toEqual({
      scope: "section",
      created_count: 1,
      updated_count: 0,
      ignored_count: 0,
      created_ids: [CREATED_ITEM_ID],
    });
    expect(supabase.__state.auditActions).toEqual([
      "takeoff.apply.started",
      "takeoff.apply.completed",
    ]);
  });

  it("maps rpc conflicts to TakeoffError and logs failed audit event", async () => {
    const supabase = createSupabaseMock({
      rpcError: {
        code: "P0001",
        message: "APPLY_CONFLICT",
        details: "already applied",
        hint: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    await expect(
      applyTakeoffJob(JOB_ID, {
        strategy: "merge",
        target_section_id: SECTION_ID,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });

    expect(supabase.__state.auditActions).toEqual([
      "takeoff.apply.started",
      "takeoff.apply.failed",
    ]);
  });
});
