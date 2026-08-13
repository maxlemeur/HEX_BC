import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/metrics/stats/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

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
    in: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };

  builder.eq.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.not.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);

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
        created_at: "2026-03-08T10:00:00.000Z",
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
    data: [
      {
        id: "item-c-1",
        job_id: "job-c-1",
        confidence: 0.9,
        evidence: "Repère C-12",
        source_page: 2,
        is_excluded: false,
      },
      {
        id: "item-c-2",
        job_id: "job-c-1",
        confidence: 0.4,
        evidence: null,
        source_page: null,
        is_excluded: false,
      },
    ],
    error: null,
  });
  const itemsSelect = vi.fn(() => itemsBuilder);

  const auditLogsBuilder = createAwaitableBuilder({
    data: [
      {
        record_id: "job-c-1",
        action: "takeoff.item.modified",
        created_at: "2026-03-08T11:00:00.000Z",
        after_data: {
          metadata: {
            field: "is_verified",
            next_value: true,
          },
        },
      },
      {
        record_id: "job-c-1",
        action: "takeoff.dpgf.review_decision",
        created_at: "2026-03-08T11:30:00.000Z",
        after_data: {
          metadata: {
            next_decision: "keep_takeoff",
          },
        },
      },
    ],
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
          select: itemsSelect,
        };
      }

      if (table === "audit_logs") {
        return {
          select: vi.fn(() => auditLogsBuilder),
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
      auditLogsBuilder,
      itemsSelect,
    },
  };
}

describe("GET /api/takeoff/metrics/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns metrics payload and applies optional level filter", async () => {
    const { supabase, builders } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(isTakeoffEnabled).mockResolvedValue(true);

    const response = await GET(
      new Request("http://localhost/api/takeoff/metrics/stats?period=7d&level=C")
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        period: string;
        kpis: { totalJobs: number };
        corrections: {
          kpis: { quicklyValidatedJobs: number };
        };
        calibration: {
          status: string;
          appliedHighScoreItems: number;
        };
        pilot: {
          killSwitchEnabled: boolean;
          weeklySnapshots: Array<{ totalJobs: number }>;
          goNoGo: { status: string };
        };
        costByLevel: Array<{ level: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.period).toBe("7d");
    expect(body.data.kpis.totalJobs).toBe(1);
    expect(body.data.corrections.kpis.quicklyValidatedJobs).toBe(0);
    expect(body.data.calibration).toMatchObject({
      status: "no_data",
      appliedHighScoreItems: 0,
    });
    expect(body.data.pilot.killSwitchEnabled).toBe(true);
    expect(body.data.pilot.weeklySnapshots[0]?.totalJobs).toBe(1);
    expect(body.data.pilot.goNoGo.status).toBe("inconclusive");
    expect(body.data.costByLevel).toEqual([
      expect.objectContaining({ level: "C" }),
    ]);
    expect(builders.jobsBuilder.eq).toHaveBeenCalledWith("level", "C");
    expect(builders.runMetricsBuilder.eq).toHaveBeenCalledWith("level", "C");
    expect(builders.itemsSelect).toHaveBeenCalledWith(
      "id, job_id, confidence, evidence, source_page, is_excluded"
    );
    expect(builders.auditLogsBuilder.in).toHaveBeenNthCalledWith(1, "record_id", [
      "job-c-1",
    ]);
    expect(builders.auditLogsBuilder.in).toHaveBeenNthCalledWith(2, "action", [
      "takeoff.item.excluded",
      "takeoff.item.modified",
      "takeoff.dpgf.review_decision",
    ]);
    expect(supabase.from).not.toHaveBeenCalledWith("takeoff_dpgf_review_decisions");
  });

  it("returns 400 for invalid level parameter", async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(isTakeoffEnabled).mockResolvedValue(true);

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

  it("keeps pilot metrics readable when the tenant kill switch is off", async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(isTakeoffEnabled).mockResolvedValue(false);

    const response = await GET(
      new Request("http://localhost/api/takeoff/metrics/stats?period=30d")
    );
    const body = (await response.json()) as {
      ok: boolean;
      data: { pilot: { killSwitchEnabled: boolean; killSwitchLabel: string } };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.pilot.killSwitchEnabled).toBe(false);
    expect(body.data.pilot.killSwitchLabel).toBe("Pilote coupé");
  });
});
