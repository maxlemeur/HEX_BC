import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/metrics/stats/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

type QueryResponse<T> = {
  data: T;
  error: null;
};

function createAwaitableBuilder<T>(response: QueryResponse<T>) {
  const promise = Promise.resolve(response);
  const builder = {
    eq: vi.fn(),
    gte: vi.fn(),
    not: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };

  builder.eq.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.not.mockReturnValue(builder);

  return builder;
}

function createSupabaseMock() {
  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: "admin",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const jobsBuilder = createAwaitableBuilder({
    data: [
      {
        id: "job-c-1",
        status: "failed",
        level: "C",
        model: "gemini-3-pro-preview",
        duration_ms: null,
        cost_cents: 12,
        retry_count: 1,
        error_code: "AI_TIMEOUT",
        created_at: "2026-02-25T10:00:00.000Z",
      },
    ],
    error: null,
  });

  const runMetricsBuilder = createAwaitableBuilder({
    data: [
      {
        job_id: "job-c-1",
        input_tokens: 100,
        reasoning_tokens: 40,
        output_tokens: 20,
        timed_out: true,
        budget_exceeded: false,
      },
    ],
    error: null,
  });

  const resultsBuilder = createAwaitableBuilder({
    data: [{ job_id: "job-c-1", confidence: 0.45 }],
    error: null,
  });

  const itemsBuilder = createAwaitableBuilder({
    data: [{ job_id: "job-c-1" }, { job_id: "job-c-1" }],
    error: null,
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => jobsBuilder),
        };
      }

      if (table === "takeoff_run_metrics") {
        return {
          select: vi.fn(() => runMetricsBuilder),
        };
      }

      if (table === "takeoff_results") {
        return {
          select: vi.fn(() => resultsBuilder),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn(() => itemsBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    builders: {
      jobsBuilder,
      runMetricsBuilder,
    },
  };
}

describe("GET /api/takeoff/metrics/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns metrics payload and applies optional level filter", async () => {
    const { supabase, builders } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);

    const response = await GET(
      new Request("http://localhost/api/takeoff/metrics/stats?period=7d&level=C")
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        period: string;
        kpis: { totalJobs: number };
        costByLevel: Array<{ level: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.period).toBe("7d");
    expect(body.data.kpis.totalJobs).toBe(1);
    expect(body.data.costByLevel).toEqual([
      expect.objectContaining({ level: "C" }),
    ]);
    expect(builders.jobsBuilder.eq).toHaveBeenCalledWith("level", "C");
    expect(builders.runMetricsBuilder.eq).toHaveBeenCalledWith("level", "C");
  });

  it("returns 400 for invalid level parameter", async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);

    const response = await GET(
      new Request("http://localhost/api/takeoff/metrics/stats?level=Z")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("BAD_REQUEST");
  });
});
