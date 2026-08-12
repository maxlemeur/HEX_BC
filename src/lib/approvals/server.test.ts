import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/direction/server", () => ({
  fetchDirectionProjectSignals: vi.fn(),
}));

import {
  fetchApprovalQueue,
  markApprovalQueueItemState,
} from "@/lib/approvals/server";
import { fetchDirectionProjectSignals } from "@/lib/direction/server";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";

const NOW = Date.parse("2026-07-31T12:00:00.000Z");

type RpcResult = {
  data: unknown[] | null;
  error: { message: string } | null;
};

function createContext(input?: {
  role?: string;
  rpcResult?: RpcResult;
  upsertError?: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(
    input?.rpcResult ?? {
      data: [],
      error: null,
    }
  );
  const upsert = vi.fn().mockResolvedValue({
    error: input?.upsertError ?? null,
  });
  const from = vi.fn(() => ({ upsert }));

  return {
    context: {
      supabase: { rpc, from },
      userId: "11111111-1111-4111-8111-111111111111",
      tenantId: "22222222-2222-4222-8222-222222222222",
      tenantRole: input?.role ?? "admin",
    },
    from,
    rpc,
    upsert,
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
    submission_message: "A valider",
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

  it("returns no data for roles that cannot review without querying the RPC", async () => {
    const { context, rpc } = createContext({ role: "engineer" });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(
      fetchApprovalQueue({ sortBy: "priority", sortDir: "desc", onlyExceptions: false })
    ).resolves.toEqual([]);

    expect(rpc).not.toHaveBeenCalled();
    expect(fetchDirectionProjectSignals).not.toHaveBeenCalled();
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
        { key: "missing_documents", label: "Pieces manquantes", count: 2 },
      ],
    });
    expect(result[1]).toMatchObject({
      projectId: "project-2",
      syntheticAlerts: [SYNTHETIC_ALERT],
      visualState: "new",
    });
  });

  it("reverses the canonical RPC order for the opposite direction", async () => {
    const rows = [
      approvalRow(),
      approvalRow({
        project_id: "project-2",
        version_id: "version-2",
        cycle_id: "cycle-2",
        project_name: "Affaire Beta",
      }),
    ];
    const { context } = createContext({
      rpcResult: { data: rows, error: null },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchDirectionProjectSignals).mockResolvedValue({
      latestJobId: null,
      alerts: [],
    } as never);

    const result = await fetchApprovalQueue({
      sortBy: "amount",
      sortDir: "asc",
      onlyExceptions: false,
    });

    expect(result.map((item) => item.projectId)).toEqual([
      "project-2",
      "project-1",
    ]);
    expect(rows[0]?.project_id).toBe("project-1");
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

  it("surfaces an RPC failure with its provider message", async () => {
    const { context } = createContext({
      rpcResult: {
        data: null,
        error: { message: "database unavailable" },
      },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(
      fetchApprovalQueue({ sortBy: "age", sortDir: "asc", onlyExceptions: false })
    ).rejects.toThrow(
      "Erreur lors du chargement de la file d'approbation: database unavailable"
    );
  });
});

describe("markApprovalQueueItemState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-reviewer role before touching the table", async () => {
    const { context, from } = createContext({ role: "viewer" });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(
      markApprovalQueueItemState("cycle-1", "seen")
    ).rejects.toThrow(
      "Seuls les administrateurs et directeurs peuvent modifier l'etat de revue."
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("upserts the reviewer state with the complete tenant scope", async () => {
    const { context, from, upsert } = createContext({ role: "director" });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(
      markApprovalQueueItemState("cycle-1", "acceptable")
    ).resolves.toBeUndefined();

    expect(from).toHaveBeenCalledWith("approval_queue_reviewer_states");
    expect(upsert).toHaveBeenCalledWith(
      {
        tenant_id: context.tenantId,
        cycle_id: "cycle-1",
        reviewer_id: context.userId,
        state: "acceptable",
      },
      { onConflict: "tenant_id,cycle_id,reviewer_id" }
    );
  });

  it("surfaces an upsert failure", async () => {
    const { context } = createContext({
      upsertError: { message: "write failed" },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(
      markApprovalQueueItemState("cycle-1", "blocking")
    ).rejects.toThrow("Erreur lors de la mise a jour de l'etat: write failed");
  });
});
