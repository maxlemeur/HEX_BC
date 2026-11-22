import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/direction/server", () => ({
  fetchDirectionProjectSignals: vi.fn(),
}));

import { fetchApprovalQueue } from "@/lib/approvals/server";
import { fetchDirectionProjectSignals } from "@/lib/direction/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

type RpcResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function createContext(input?: {
  rpcResult?: RpcResult;
}) {
  const rpc = vi.fn().mockResolvedValue(
    input?.rpcResult ?? {
      data: [],
      error: null,
    }
  );

  return {
    context: {
      supabase: { rpc },
      userId: "11111111-1111-4111-8111-111111111111",
      tenantId: "22222222-2222-4222-8222-222222222222",
      tenantRole: "admin",
    },
    rpc,
  };
}

function approvalRow(
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    project_id: "project-1",
    version_id: "version-1",
    cycle_id: "cycle-1",
    project_name: "Affaire Alpha",
    client_name: "Client Alpha",
    version_number: 3,
    amount_ht_cents: 125_000,
    margin_bp: 1_500,
    requested_at: "2026-07-31T10:30:00.000Z",
    submission_message: "À valider",
    comment_count: 0,
    reviewer_state: null,
    exception_count: 0,
    max_risk_score: 0,
    cause_code_counts: {},
    latest_job_id: null,
    ...overrides,
  };
}

const SYNTHETIC_ALERT = {
  alertKey: "project-2:version-2:deadline",
  projectId: "project-2",
  projectName: "Affaire Beta",
  versionId: "version-2",
  jobId: null,
  latestJobId: null,
  level: "warning",
  label: "Dossier incomplet",
  reasons: ["Une piece manque."],
  status: "to_process",
  alertIds: ["alert-1"],
  lotLabels: [],
} as const;

describe("fetchApprovalQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps exception groups, tolerates one signal failure, and filters empty items", async () => {
    const rows = [
      approvalRow({
        comment_count: 2,
        exception_count: 5,
        max_risk_score: 72,
        cause_code_counts: {
          atypical_price: 2,
          insufficient_margin: 1,
          missing_piece: 2,
          unknown_signal: 99,
        },
      }),
      approvalRow({
        project_id: "project-2",
        version_id: "version-2",
        cycle_id: "cycle-2",
        project_name: "Affaire Beta",
      }),
      approvalRow({
        project_id: "project-3",
        version_id: "version-3",
        cycle_id: "cycle-3",
        project_name: "Affaire Gamma",
      }),
    ];
    const { context, rpc } = createContext({
      rpcResult: { data: rows, error: null },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchDirectionProjectSignals).mockImplementation(
      async (projectId) => {
        if (projectId === "project-2") {
          return { latestJobId: null, alerts: [SYNTHETIC_ALERT] } as never;
        }
        if (projectId === "project-3") {
          throw new Error("signals unavailable");
        }
        return { latestJobId: null, alerts: [] } as never;
      }
    );

    const result = await fetchApprovalQueue({
      sortBy: "amount",
      sortDir: "desc",
      onlyExceptions: true,
    });

    expect(rpc).toHaveBeenCalledWith("list_approval_queue", {
      p_sort_by: "amount",
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      projectId: "project-1",
      versionLabel: "V3",
      requestAgeLabel: expect.stringContaining("heure"),
      visualState: "commented",
      exceptionGroups: [
        { key: "price", label: "Prix", count: 3 },
        { key: "missing_documents", label: "Pièces manquantes", count: 2 },
      ],
    });
    expect(result[1]).toMatchObject({
      projectId: "project-2",
      syntheticAlerts: [SYNTHETIC_ALERT],
      visualState: "new",
    });
  });

  it("displays and sorts the effective margins returned by Direction", async () => {
    const rows = [
      approvalRow({
        project_id: "project-high-cost",
        version_id: "version-high-cost",
        cycle_id: "cycle-high-cost",
        margin_bp: 3_750,
      }),
      approvalRow({
        project_id: "project-low-cost",
        version_id: "version-low-cost",
        cycle_id: "cycle-low-cost",
        margin_bp: 2_857,
      }),
    ];
    const { context } = createContext({
      rpcResult: { data: rows, error: null },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchDirectionProjectSignals).mockImplementation(
      async (projectId) => ({
        latestJobId: null,
        marginBp: projectId === "project-high-cost" ? 2_857 : 3_750,
        alerts: [],
      }) as never
    );

    const result = await fetchApprovalQueue({
      sortBy: "margin",
      sortDir: "asc",
      onlyExceptions: false,
    });

    expect(result.map((item) => [item.versionId, item.marginBp])).toEqual([
      ["version-high-cost", 2_857],
      ["version-low-cost", 3_750],
    ]);
  });

  // The independent reading of #501: the queue read the latest jobs' list reading once per version (through the radar's
  // signals, up to two statements per row). It is read once for the queue, and the radar's signals are asked for none.
  it("reads which latest jobs were read against the list once for the whole queue", async () => {
    const job = (n: number) => `e1000000-0000-4000-8000-00000000000${n}`;
    const listRequest = "f1000000-0000-4000-8000-000000000001";
    const rows = [1, 2, 3].map((n) => approvalRow({ project_id: `project-${n}`, version_id: `version-${n}`, cycle_id: `cycle-${n}`,
      exception_count: 1, latest_job_id: job(n) }));
    const { context } = createContext({ rpcResult: { data: rows, error: null } });
    const jobs = [{ id: job(1), launch_request_id: listRequest }, { id: job(3), launch_request_id: listRequest }];
    const reads: string[] = [];
    const from = vi.fn((table: string) => {
      reads.push(table);
      const builder = {
        select: () => builder, eq: () => builder, in: () => builder, not: () => builder,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "takeoff_jobs" ? jobs
          : [{ id: listRequest }], error: null }).then(resolve),
      };
      return builder;
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({ ...context, supabase: { ...context.supabase, from } } as never);
    vi.mocked(fetchDirectionProjectSignals).mockImplementation(async (projectId) =>
      ({ latestJobId: null, alerts: projectId === "project-2"
        ? [{ ...SYNTHETIC_ALERT, latestJobId: job(3), jobId: job(3) }] : [] }) as never);

    const result = await fetchApprovalQueue({ sortBy: "amount", sortDir: "desc", onlyExceptions: false } as never);

    expect(Object.fromEntries(result.map((item) => [item.projectId, item.latestJobReadsList])))
      .toEqual({ "project-1": true, "project-2": false, "project-3": true });
    expect(result.find((item) => item.projectId === "project-2")?.syntheticAlerts[0]).toMatchObject({ latestJobReadsList: true });
    expect(reads).toEqual(["takeoff_jobs", "takeoff_launch_requests"]);
    for (const call of vi.mocked(fetchDirectionProjectSignals).mock.calls) expect(call[2]).toBe(false);
  });


  // The second reading of #501: the list reading is optional. When it fails after the queue's own read, the queue still
  // comes back, every row's flag unknown (false): its card keeps today's link, which the review's resolver redirects for
  // a job read against the list.
  it("still returns the queue when the list reading fails, every row keeping today's link", async () => {
    const rows = [1, 2].map((n) => approvalRow({ project_id: `project-${n}`, version_id: `version-${n}`, cycle_id: `cycle-${n}`,
      exception_count: 1, latest_job_id: `e1000000-0000-4000-8000-00000000000${n}` }));
    const { context } = createContext({ rpcResult: { data: rows, error: null } });
    for (const failure of ["rejects", "answers an error"] as const) {
      const from = vi.fn(() => {
        const answer = failure === "rejects" ? Promise.reject(new Error("statement timeout"))
          : Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } });
        const builder = {
          select: () => builder, eq: () => builder, in: () => builder, not: () => builder,
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => answer.then(resolve, reject),
        };
        return builder;
      });
      vi.mocked(getAuthenticatedContext).mockResolvedValue({ ...context, supabase: { ...context.supabase, from } } as never);
      vi.mocked(fetchDirectionProjectSignals).mockResolvedValue({ latestJobId: null, alerts: [] } as never);

      const result = await fetchApprovalQueue({ sortBy: "amount", sortDir: "desc", onlyExceptions: false } as never);

      expect(result.map((item) => [item.projectId, item.latestJobReadsList]), failure)
        .toEqual([["project-1", false], ["project-2", false]]);
      expect(from, failure).toHaveBeenCalled();
    }
  });

});
