import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/estimates/server", () => ({
  getEstimateSendGating: vi.fn(),
  getEstimateSupplierComparisons: vi.fn(),
  listEstimateItems: vi.fn(),
  listEstimateProjectVersions: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/server", () => ({
  fetchTakeoffDpgfSummaryForHub: vi.fn(),
}));

vi.mock("@/lib/affaires/register-server", () => ({
  fetchAffaireRegisterGateSummary: vi.fn(),
}));

vi.mock("@/lib/affaires/intake-server", () => ({
  fetchAffaireIntakeWorkspace: vi.fn(),
}));

vi.mock("@/lib/estimates/v3-margin-evidence-server", () => ({
  loadV3MarginEvidence: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import { fetchTakeoffDpgfSummaryForHub } from "@/lib/takeoff/server";
import { loadV3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import {
  getEstimateSendGating,
  getEstimateSupplierComparisons,
  listEstimateItems,
} from "@/lib/estimates/server";
import {
  buildAffaireHubReadinessSnapshot,
  fetchAffaireDashboardOverview,
  fetchAffaireHubMarginAnalysis,
  fetchAffaireHubPlansSummary,
  fetchAffaireHubSummary,
  fetchAffaireList,
  fetchAffaireManagerQueueSummary,
  fetchAffairePageData,
} from "@/lib/affaires/server";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type TenantRole = "admin" | "engineer" | "viewer";

type RpcResult = {
  data: unknown;
  error: null;
};

type QueryResult = {
  data: unknown;
  error: unknown | null;
  count?: number | null;
};

type TableQueryScenario = {
  limit?: QueryResult;
  maybeSingle?: QueryResult;
};

beforeEach(() => {
  vi.mocked(fetchAffaireIntakeWorkspace).mockResolvedValue({
    projectId: PROJECT_ID,
    uploadId: null,
    documents: [],
    missingPieces: [],
    readiness: {
      reviewDocumentsCount: 0,
      missingPiecesCount: 0,
      criticalMissingPiecesCount: 0,
      provisionalMissingPiecesCount: 0,
      provisionalCriticalMissingPiecesCount: 0,
      confirmedMissingPiecesCount: 0,
      confirmedCriticalMissingPiecesCount: 0,
      reviewCouldLiftCriticalMissing: false,
      reviewBeforeMissing: false,
      dominantAction: "none",
      hubReadinessImpact: "none",
    },
    briefDraft: null,
  } as never);
  vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
    openQuestionsCount: 0,
    criticalOpenEntries: [],
    nonCriticalOpenEntries: [],
    clarifyWithClientEntries: [],
    criticalClarifyWithClientEntries: [],
    openAssumptionEntries: [],
    openMissingPieceEntries: [],
    continuedWithHypothesisEntries: [],
    continuedCriticalMissingPieceEntries: [],
    revalidationRequiredEntries: [],
    criticalRevalidationRequiredEntries: [],
    revalidationImpactedStages: [],
  } as never);
  vi.mocked(getEstimateSendGating).mockResolvedValue({
    gating: {
      canSend: true,
      blockingFlags: [],
      warningFlags: [],
      stalePriceDays: 30,
      checkedAt: "2026-03-14T10:00:00.000Z",
    },
  } as never);
  vi.mocked(listEstimateItems).mockResolvedValue({
    items: [],
  } as never);
  vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
    coverage_summary: {
      covered_items: 0,
      ambiguous_items: 0,
      no_price_items: 0,
      stale_items: 0,
    },
  } as never);
});

function createContext(options?: { role?: TenantRole; rpcResult?: RpcResult }) {
  const rpc = vi.fn().mockResolvedValue(
    options?.rpcResult ?? {
      data: [],
      error: null,
    }
  );

  return {
    supabase: {
      rpc,
      from: createFromMock({}),
    },
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: options?.role ?? "engineer",
  };
}

function createFromMock(
  tableScenarios: Record<string, TableQueryScenario[]>
) {
  return vi.fn((table: string) => {
    const defaultResult: QueryResult = {
      data: null,
      error: null,
      count: null,
    };
    const queue = tableScenarios[table];

    if (
      (!queue || queue.length === 0) &&
      (table === "estimate_versions" ||
        table === "takeoff_version_links" ||
        table === "estimate_items")
    ) {
      tableScenarios[table] = [
        {
          maybeSingle: defaultResult,
          limit: defaultResult,
        },
      ];
    }

    const effectiveQueue = tableScenarios[table];
    if (!effectiveQueue || effectiveQueue.length === 0) {
      throw new Error(`Unexpected from() table call: ${table}`);
    }

    const scenario = effectiveQueue.shift()!;

    let isListCurrencyRead = false;
    let currencyIds: string[] = [];
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      range: vi.fn(),
      maybeSingle: vi.fn(),
      then: undefined as
        | ((onfulfilled?: (value: QueryResult) => unknown, onrejected?: (reason: unknown) => unknown) => Promise<unknown>)
        | undefined,
    };

    builder.select.mockImplementation((columns: string) => {
      isListCurrencyRead = table === "estimate_versions" && columns === "id, currency, total_ht_cents";
      return builder;
    });
    builder.eq.mockReturnValue(builder);
    builder.in.mockImplementation((column: string, values: string[]) => {
      if (isListCurrencyRead && column === "id") currencyIds = values;
      return builder;
    });
    builder.order.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
    builder.range.mockReturnValue(builder);
    builder.maybeSingle.mockImplementation(
      async () => scenario.maybeSingle ?? defaultResult
    );
    builder.then = (onfulfilled, onrejected) =>
      Promise.resolve(isListCurrencyRead
        // These retained list/readiness fixtures all describe EUR estimates.
        // The real multi-currency reader and UI are exercised by LEGCUR02.
        ? { data: currencyIds.map((id) => ({ id, currency: "EUR",
          total_ht_cents: buildAffaireRow(Number(id.slice(-12))).current_total_ht_cents })), error: null }
        : scenario.limit ?? defaultResult).then(onfulfilled, onrejected);

    return builder;
  });
}

function createHubContext(options: {
  role?: TenantRole;
  tableScenarios: Record<string, TableQueryScenario[]>;
}) {
  const from = createFromMock(options.tableScenarios);
  return {
    supabase: {
      // The version's lines (read_estimate_version_items) answer from the next estimate_items scenario.
      rpc: vi.fn((functionName: string) =>
        functionName === "read_estimate_version_items" ? from("estimate_items") : undefined),
      from,
    },
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: options.role ?? "engineer",
  };
}

function buildAffaireRow(
  index: number,
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    project_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    project_name: `Projet ${index}`,
    project_reference: `REF-${index}`,
    project_client: `Client ${index}`,
    is_favorite: false,
    version_count: 1,
    has_current_version: true,
    current_version_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    current_version_number: index,
    current_status: "draft" as const,
    current_total_ht_cents: 1_000 * index,
    current_updated_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T10:00:00+00:00`,
    accepted_version_id: null,
    accepted_version_number: null,
    ...overrides,
  };
}

describe("affaires hub readiness contract", () => {
  it("keeps a confirmed brief with critical missing pieces under reservations", () => {
    const snapshot = buildAffaireHubReadinessSnapshot({
      lineCount: 0,
      briefStatus: "confirme",
      intakeReadiness: {
        reviewDocumentsCount: 0,
        confirmedMissingPiecesCount: 2,
        confirmedCriticalMissingPiecesCount: 2,
      },
      registerGateSummary: {
        criticalOpenEntries: [{ id: "missing-dpgf" }],
        clarifyWithClientEntries: [],
        continuedWithHypothesisEntries: [],
        revalidationRequiredEntries: [],
        criticalRevalidationRequiredEntries: [],
      },
    });

    expect(snapshot.status).toBe("ready_with_reservations");
    expect(snapshot.workingBasis).toBe("established");
    expect(snapshot.briefStatus).toBe("confirme");
    expect(snapshot.drivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "critical_missing_piece",
          source: "intake",
          severity: "critical",
          count: 2,
        }),
      ])
    );
  });

  it("marks dossiers without confirmed brief or structure as not ready", () => {
    const snapshot = buildAffaireHubReadinessSnapshot({
      lineCount: 0,
      briefStatus: "a_confirmer",
      intakeReadiness: {
        reviewDocumentsCount: 0,
        confirmedMissingPiecesCount: 0,
        confirmedCriticalMissingPiecesCount: 0,
      },
      registerGateSummary: {
        criticalOpenEntries: [],
        clarifyWithClientEntries: [],
        continuedWithHypothesisEntries: [],
        revalidationRequiredEntries: [],
        criticalRevalidationRequiredEntries: [],
      },
    });

    expect(snapshot.status).toBe("not_ready");
    expect(snapshot.workingBasis).toBe("insufficient");
    expect(snapshot.drivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "brief_to_confirm",
          source: "brief",
          severity: "critical",
        }),
      ])
    );
  });

  it("keeps CCTP-driven continuation under reservations until the brief is confirmed", () => {
    const snapshot = buildAffaireHubReadinessSnapshot({
      lineCount: 0,
      briefStatus: "a_confirmer",
      preliminaryStructureCanOpen: true,
      intakeReadiness: {
        reviewDocumentsCount: 0,
        confirmedMissingPiecesCount: 0,
        confirmedCriticalMissingPiecesCount: 0,
      },
      registerGateSummary: {
        criticalOpenEntries: [],
        clarifyWithClientEntries: [],
        continuedWithHypothesisEntries: [],
        revalidationRequiredEntries: [],
        criticalRevalidationRequiredEntries: [],
      },
    });

    expect(snapshot.status).toBe("ready_with_reservations");
    expect(snapshot.workingBasis).toBe("established");
    expect(snapshot.allowsContinuation).toBe(true);
  });

  it("keeps accepted continuation dossiers under reservations before structure exists", () => {
    const snapshot = buildAffaireHubReadinessSnapshot({
      lineCount: 0,
      briefStatus: "a_confirmer",
      intakeReadiness: {
        reviewDocumentsCount: 0,
        confirmedMissingPiecesCount: 0,
        confirmedCriticalMissingPiecesCount: 0,
      },
      registerGateSummary: {
        criticalOpenEntries: [{ id: "missing-plan" }],
        clarifyWithClientEntries: [],
        continuedWithHypothesisEntries: [{ id: "missing-plan" }],
        revalidationRequiredEntries: [],
        criticalRevalidationRequiredEntries: [],
      },
    });

    expect(snapshot.status).toBe("ready_with_reservations");
    expect(snapshot.workingBasis).toBe("established");
    expect(snapshot.allowsContinuation).toBe(true);
    expect(snapshot.drivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "continued_with_hypothesis",
          source: "register",
          severity: "warning",
          count: 1,
        }),
      ])
    );
  });

  it("downgrades confirmed dossiers when critical register entries stay open", () => {
    const snapshot = buildAffaireHubReadinessSnapshot({
      lineCount: 12,
      briefStatus: "confirme",
      intakeReadiness: {
        reviewDocumentsCount: 0,
        confirmedMissingPiecesCount: 0,
        confirmedCriticalMissingPiecesCount: 0,
      },
      registerGateSummary: {
        criticalOpenEntries: [{ id: "manual-critical-assumption" }],
        clarifyWithClientEntries: [],
        continuedWithHypothesisEntries: [],
        revalidationRequiredEntries: [],
        criticalRevalidationRequiredEntries: [],
      },
    });

    expect(snapshot.status).toBe("ready_with_reservations");
    expect(snapshot.workingBasis).toBe("established");
    expect(snapshot.register.criticalOpenCount).toBe(1);
  });
});

describe("affaires server (list + counters)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes engineer owner scope to list_affaires_page", async () => {
    const row = buildAffaireRow(1);
    const context = createContext({
      role: "engineer",
      rpcResult: {
        data: [row],
        error: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireList({
      q: "Projet",
      status: ["draft"],
      size: 20,
      sort: "updatedAt",
      dir: "asc",
    });

    expect(context.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(context.supabase.rpc).toHaveBeenCalledWith("list_affaires_page", {
      p_tenant_id: TENANT_ID,
      p_owner_user_id: USER_ID,
      p_limit: 21,
      p_search: "Projet",
      p_statuses: ["draft"],
      p_favorites_only: false,
      p_cursor_updated_at: null,
      p_cursor_name: null,
      p_cursor_total_ht_cents: null,
      p_cursor_project_id: null,
      p_sort_by: "updatedAt",
      p_sort_dir: "asc",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      projectId: row.project_id,
      projectName: row.project_name,
      isFavorite: false,
      hasCurrentVersion: true,
      currentVersionId: row.current_version_id,
      currentStatus: "draft",
    });
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
  });


  it("loads a 1,000-affaire page through the legacy 101-row RPC cap", async () => {
    const allRows = Array.from({ length: 1001 }, (_, index) =>
      buildAffaireRow(index + 1)
    );
    let offset = 0;
    const context = createContext({ role: "admin" });
    context.supabase.rpc.mockImplementation(
      (_name: string, args: { p_limit: number }) => {
        const batchSize = Math.min(args.p_limit, 101);
        const data = allRows.slice(offset, offset + batchSize);
        offset += data.length;
        return Promise.resolve({ data, error: null });
      }
    );
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireList({ size: 1000 });

    expect(context.supabase.rpc).toHaveBeenCalledTimes(10);
    expect(context.supabase.rpc.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ p_limit: 1001, p_cursor_project_id: null })
    );
    expect(context.supabase.rpc.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        p_limit: 900,
        p_cursor_project_id: allRows[100]!.project_id,
      })
    );
    expect(result.items).toHaveLength(1000);
    expect(result.pageSize).toBe(1000);
    expect(result.hasNextPage).toBe(true);
    expect(result.nextCursor).toBeTruthy();
  });
  it("passes name and amount cursors to the matching server sort", async () => {
    const row = buildAffaireRow(1);
    const context = createContext({
      role: "engineer",
      rpcResult: { data: [row], error: null },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const nameCursor = Buffer.from(
      JSON.stringify({
        sort: "name",
        value: row.project_name,
        projectId: row.project_id,
      }),
      "utf8"
    ).toString("base64url");
    await fetchAffaireList({
      sort: "name",
      dir: "asc",
      cursor: nameCursor,
    });

    expect(context.supabase.rpc).toHaveBeenLastCalledWith(
      "list_affaires_page",
      expect.objectContaining({
        p_cursor_updated_at: null,
        p_cursor_name: row.project_name,
        p_cursor_total_ht_cents: null,
        p_cursor_project_id: row.project_id,
        p_sort_by: "name",
        p_sort_dir: "asc",
      })
    );

    const amountCursor = Buffer.from(
      JSON.stringify({
        sort: "totalHtCents",
        value: row.current_total_ht_cents,
        projectId: row.project_id,
      }),
      "utf8"
    ).toString("base64url");
    await fetchAffaireList({
      sort: "totalHtCents",
      dir: "desc",
      cursor: amountCursor,
    });

    expect(context.supabase.rpc).toHaveBeenLastCalledWith(
      "list_affaires_page",
      expect.objectContaining({
        p_cursor_updated_at: null,
        p_cursor_name: null,
        p_cursor_total_ht_cents: row.current_total_ht_cents,
        p_cursor_project_id: row.project_id,
        p_sort_by: "totalHtCents",
        p_sort_dir: "desc",
      })
    );
  });

  it("rejects a cursor created for another sort", async () => {
    const row = buildAffaireRow(1);
    const context = createContext({ role: "engineer" });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    const cursor = Buffer.from(
      JSON.stringify({
        sort: "name",
        value: row.project_name,
        projectId: row.project_id,
      }),
      "utf8"
    ).toString("base64url");

    await expect(
      fetchAffaireList({ sort: "totalHtCents", cursor })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(context.supabase.rpc).not.toHaveBeenCalled();
  });

  it("builds hasNextPage and nextCursor with keyset payload", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => buildAffaireRow(index + 1));
    const context = createContext({
      role: "engineer",
      rpcResult: {
        data: rows,
        error: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireList({ size: 20 });

    expect(result.items).toHaveLength(20);
    expect(result.hasNextPage).toBe(true);
    expect(result.nextCursor).toBeTruthy();

    const decodedCursorRaw = Buffer.from(
      result.nextCursor!.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const decodedCursor = JSON.parse(decodedCursorRaw) as {
      sort: string;
      value: string;
      projectId: string;
    };
    const lastVisibleItem = result.items[19]!;

    expect(decodedCursor).toEqual({
      sort: "updatedAt",
      value: lastVisibleItem.currentUpdatedAt,
      projectId: lastVisibleItem.projectId,
    });
  });

  it("applies the manager queue filter before pagination and counters", async () => {
    const rows = Array.from({ length: 21 }, (_, index) =>
      buildAffaireRow(index + 1, {
        project_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        project_name:
          index === 20 ? "Projet relance portefeuille" : `Projet visible ${index + 1}`,
        current_updated_at: `2026-03-${String(21 - index).padStart(2, "0")}T10:00:00+00:00`,
      })
    );
    const rpc = vi.fn(async (fnName: string): Promise<RpcResult> => {
      if (fnName === "list_affaires_page") {
        return {
          data: rows,
          error: null,
        };
      }

      if (fnName === "get_affaires_counters") {
        return {
          data: [
            {
              total_count: 5,
              filtered_count: 3,
              draft_count: 3,
              sending_count: 0,
              sent_count: 0,
              accepted_count: 0,
              archived_count: 0,
            },
          ],
          error: null,
        };
      }

      return { data: [], error: null };
    });
    const context = {
      supabase: {
        rpc,
        from: createFromMock({
          estimate_items: Array.from({ length: 21 }, () => ({
            limit: {
              data: null,
              count: 0,
              error: null,
            },
          })),
        }),
      },
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "engineer" as const,
    };

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchAffaireIntakeWorkspace).mockImplementation(async (projectId: string) => ({
      projectId,
      uploadId: null,
      documents: [],
      missingPieces: [],
      readiness: {
        reviewDocumentsCount: 0,
        missingPiecesCount: 0,
        criticalMissingPiecesCount: 0,
        provisionalMissingPiecesCount: 0,
        provisionalCriticalMissingPiecesCount: 0,
        confirmedMissingPiecesCount: 0,
        confirmedCriticalMissingPiecesCount: 0,
        reviewCouldLiftCriticalMissing: false,
        reviewBeforeMissing: false,
        dominantAction: "none",
        hubReadinessImpact: "none",
      },
      briefDraft:
        projectId === "00000000-0000-4000-8000-000000000021"
          ? { status: "a_confirmer" }
          : { status: "confirme" },
    } as never));
    vi.mocked(fetchAffaireRegisterGateSummary).mockImplementation(async ({ projectId }) => ({
      openQuestionsCount: 0,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries: [],
      criticalClarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
      continuedWithHypothesisEntries: [],
      continuedCriticalMissingPieceEntries: [],
      revalidationRequiredEntries: [],
      criticalRevalidationRequiredEntries: [],
      revalidationImpactedStages: [],
      ...(projectId === "00000000-0000-4000-8000-000000000021"
        ? {
            criticalOpenEntries: [{ id: `critical-${projectId}` }],
          }
        : {}),
    }) as never);

    const result = await fetchAffairePageData({
      manager: "follow_up",
      size: 20,
    });

    expect(result.list.items).toHaveLength(1);
    expect(result.list.items[0]?.projectId).toBe("00000000-0000-4000-8000-000000000021");
    expect(result.counters.totalCount).toBe(5);
    expect(result.counters.filteredCount).toBe(1);
    expect(result.counters.statusCounts.draft).toBe(1);
    expect(result.managerQueue).toEqual({
      counts: {
        followUp: 1,
        reservations: 0,
        revalidation: 0,
      },
      incompleteCount: 0,
    });
  });

  it("keeps revalidation dossiers out of the reservations bucket", async () => {
    const rows = [
      buildAffaireRow(1, {
        project_id: "00000000-0000-4000-8000-000000000101",
        project_name: "Projet revalidation",
      }),
      buildAffaireRow(2, {
        project_id: "00000000-0000-4000-8000-000000000102",
        project_name: "Projet reserve",
      }),
    ];
    const context = {
      supabase: {
        rpc: vi.fn(async (fnName: string) => ({
          data:
            fnName === "get_affaires_counters"
              ? [
                  {
                    total_count: 2,
                    filtered_count: 2,
                    draft_count: 2,
                    sending_count: 0,
                    sent_count: 0,
                    accepted_count: 0,
                    archived_count: 0,
                  },
                ]
              : rows,
          error: null,
        })),
        from: createFromMock({
          estimate_items: Array.from({ length: 2 }, () => ({
            limit: {
              data: null,
              count: 0,
              error: null,
            },
          })),
        }),
      },
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "engineer" as const,
    };

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchAffaireIntakeWorkspace).mockImplementation(async (projectId: string) => ({
      projectId,
      uploadId: null,
      documents: [],
      missingPieces: [],
      readiness: {
        reviewDocumentsCount: 0,
        missingPiecesCount: 0,
        criticalMissingPiecesCount: 0,
        provisionalMissingPiecesCount: 0,
        provisionalCriticalMissingPiecesCount: 0,
        confirmedMissingPiecesCount: 0,
        confirmedCriticalMissingPiecesCount: 0,
        reviewCouldLiftCriticalMissing: false,
        reviewBeforeMissing: false,
        dominantAction: "none",
        hubReadinessImpact: "none",
      },
      briefDraft: { status: "confirme" },
    }) as never);
    vi.mocked(fetchAffaireRegisterGateSummary).mockImplementation(async ({ projectId }) => ({
      openQuestionsCount: 0,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries:
        projectId === "00000000-0000-4000-8000-000000000102" ? [{ id: "clarify-1" }] : [],
      criticalClarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
      continuedWithHypothesisEntries: [],
      continuedCriticalMissingPieceEntries: [],
      revalidationRequiredEntries:
        projectId === "00000000-0000-4000-8000-000000000101"
          ? [{ id: "revalidation-1" }]
          : [],
      criticalRevalidationRequiredEntries: [],
      revalidationImpactedStages: [],
    }) as never);

    const reservationsResult = await fetchAffairePageData({
      manager: "reservations",
      size: 20,
    });

    expect(reservationsResult.list.items).toHaveLength(1);
    expect(reservationsResult.list.items[0]?.projectId).toBe(
      "00000000-0000-4000-8000-000000000102"
    );
    expect(reservationsResult.counters.filteredCount).toBe(1);
    expect(reservationsResult.managerQueue).toEqual({
      counts: {
        followUp: 0,
        reservations: 1,
        revalidation: 1,
      },
      incompleteCount: 0,
    });
  });

  it("treats manager classification failures as incomplete instead of silently dropping dossiers", async () => {
    const row = buildAffaireRow(1, {
      project_id: "00000000-0000-4000-8000-000000000010",
    });
    const context = {
      supabase: {
        rpc: vi.fn(async () => ({
          data: [row],
          error: null,
        })),
        from: createFromMock({
          estimate_items: [
            {
              limit: {
                data: null,
                count: 0,
                error: null,
              },
            },
          ],
        }),
      },
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "engineer" as const,
    };

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchAffaireIntakeWorkspace).mockRejectedValueOnce(
      new Error("temporary")
    );

    const summary = await fetchAffaireManagerQueueSummary();

    expect(summary).toEqual({
      counts: {
        followUp: 0,
        reservations: 0,
        revalidation: 0,
      },
      incompleteCount: 1,
    });
  });

  it("rejects oversized manager portfolios before the per-affaire fan-out", async () => {
    const context = createContext({ role: "admin" });
    context.supabase.rpc.mockImplementation(async (fnName: string) => {
      if (fnName === "get_affaires_counters") {
        return {
          data: [
            {
              total_count: 959,
              filtered_count: 959,
              draft_count: 958,
              sending_count: 0,
              sent_count: 0,
              accepted_count: 1,
              archived_count: 0,
            },
          ],
          error: null,
        };
      }

      throw new Error(`Unexpected RPC call: ${fnName}`);
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(fetchAffaireManagerQueueSummary()).rejects.toThrow(
      "MANAGER_QUEUE_PORTFOLIO_LIMIT_EXCEEDED"
    );
    expect(context.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(context.supabase.from).not.toHaveBeenCalled();
  });
});

describe("affaires hub server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 0,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
    });
  });

  it("prefers the current draft default-import plan set for auto-propose", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Plans Brouillon",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        plan_sets: [
          {
            limit: {
              data: [
                {
                  id: "set-historical-default",
                  metadata: {
                    source: "affaire-intake",
                    default_import_plan_set: true,
                  },
                  estimate_version_id: "ver-old",
                  created_at: "2026-03-02T09:00:00+00:00",
                },
                {
                  id: "set-current-latest",
                  metadata: {},
                  estimate_version_id: "ver-current",
                  created_at: "2026-03-06T09:00:00+00:00",
                },
                {
                  id: "set-current-default",
                  metadata: {
                    source: "affaire-intake",
                    default_import_plan_set: true,
                  },
                  estimate_version_id: "ver-current",
                  created_at: "2026-03-05T09:00:00+00:00",
                },
              ],
              count: 3,
              error: null,
            },
          },
        ],
        takeoff_jobs: [
          {
            maybeSingle: {
              data: null,
              error: null,
            },
          },
          {
            maybeSingle: {
              data: null,
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            maybeSingle: {
              data: {
                id: "ver-current",
              },
              error: null,
            },
          },
        ],
        plan_files: [
          {
            limit: {
              data: null,
              count: 1,
              error: null,
            },
          },
          {
            limit: {
              data: [{ file_size_bytes: 1200 }],
              error: null,
            },
          },
          {
            limit: {
              data: [
                {
                  file_name: "lot-cvc-dpgf.pdf",
                  file_type: "application/pdf",
                  page_count: 2,
                },
              ],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.defaultPlanSetId).toBe("set-current-default");
    expect(summary.launchRecommendation).toMatchObject({
      documentClass: "tabular_pdf",
      recommendedLevel: "B",
      compatibleLevels: ["B", "C"],
    });
  });

  it("returns null coverage when compare engine fails (degraded state)", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Degraded",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        plan_sets: [
          {
            limit: { data: null, count: 1, error: null },
          },
        ],
        takeoff_jobs: [
          {
            maybeSingle: {
              data: {
                id: "job-7",
                status: "completed",
                level: "B",
                source_file_name: null,
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-7",
              },
              error: null,
            },
          },
        ],
        plan_files: [
          { limit: { data: null, count: 1, error: null } },
          { limit: { data: [{ file_size_bytes: 100 }], error: null } },
        ],
      },
    });

    vi.mocked(fetchTakeoffDpgfSummaryForHub).mockRejectedValue(
      new Error("Transient DB error")
    );

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.coveragePercent).toBeNull();
    expect(summary.exceptionCount).toBeNull();
    expect(summary.latestJob?.status).toBe("review_required");
    expect(summary.latestJob?.label).toBe("Revue requise");
  });

});

describe("affaires hub margin analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies cascade discount settings from version mode/steps", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Cascade",
                reference: "AFF-CASCADE",
                client_name: "Client Cascade",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: [
                {
                  id: "v1",
                  project_id: PROJECT_ID,
                  version_number: 1,
                  status: "draft",
                  total_ht_cents: 9_000,
                  margin_multiplier: 1,
                  margin_mode: "fixed",
                  tax_rate_bp: 0,
                  discount_bp: 0,
                  discount_mode: "cascade",
                  discount_steps: [1000],
                  global_coefficient: 1,
                  updated_at: "2026-03-05T08:00:00+00:00",
                },
              ],
              error: null,
            },
          },
        ],
        estimate_items: [
          {
            limit: {
              data: [
                {
                  id: "s1",
                  parent_id: null,
                  item_type: "section",
                  position: 1,
                  title: "Section 1",
                  description: null,
                },
                {
                  id: "l1",
                  parent_id: "s1",
                  item_type: "line",
                  position: 1,
                  title: "Ligne 1",
                  description: null,
                  quantity: 1,
                  unit_price_ht_cents: 10_000,
                  tax_rate_bp: 0,
                  k_fo: 1,
                  h_mo: 0,
                  h_mo_majoration: 1,
                  k_mo: 1,
                  h_mo_atelier: null,
                  k_mo_atelier: null,
                  labor_role_atelier_id: null,
                  h_mo_chantier: null,
                  k_mo_chantier: null,
                  labor_role_chantier_id: null,
                  pu_ht_cents: 10_000,
                  labor_role_id: null,
                  category_id: null,
                  supply_type_id: null,
                  line_total_ht_cents: 10_000,
                  line_tax_cents: 0,
                  line_total_ttc_cents: 10_000,
                },
              ],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireHubMarginAnalysis(PROJECT_ID);

    expect(result).not.toBeNull();
    expect(result?.global.saleCents).toBe(9_000);
    expect(result?.global.costCents).toBe(10_000);
    expect(result?.global.marginEurCents).toBe(-1_000);
  });

  it("uses labor split payload when computing section costs and sales", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire MO Split",
                reference: "AFF-SPLIT",
                client_name: "Client Split",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: [
                {
                  id: "v1",
                  project_id: PROJECT_ID,
                  version_number: 1,
                  status: "draft",
                  total_ht_cents: 8_000,
                  margin_multiplier: 1,
                  margin_mode: "fixed",
                  tax_rate_bp: 0,
                  discount_bp: 0,
                  discount_mode: "simple",
                  discount_steps: [],
                  global_coefficient: 1,
                  updated_at: "2026-03-05T08:00:00+00:00",
                },
              ],
              error: null,
            },
          },
        ],
        estimate_items: [
          {
            limit: {
              data: [
                {
                  id: "s1",
                  parent_id: null,
                  item_type: "section",
                  position: 1,
                  title: "Section 1",
                  description: null,
                },
                {
                  id: "l1",
                  parent_id: "s1",
                  item_type: "line",
                  position: 1,
                  title: "Ligne split",
                  description: null,
                  quantity: 1,
                  unit_price_ht_cents: 0,
                  tax_rate_bp: 0,
                  k_fo: 1,
                  h_mo: 0,
                  h_mo_majoration: 1,
                  k_mo: 1,
                  h_mo_atelier: 2,
                  k_mo_atelier: 1,
                  labor_role_atelier_id: "atelier-role",
                  h_mo_chantier: 3,
                  k_mo_chantier: 1,
                  labor_role_chantier_id: "chantier-role",
                  pu_ht_cents: 8_000,
                  labor_role_id: null,
                  category_id: null,
                  supply_type_id: null,
                  line_total_ht_cents: 8_000,
                  line_tax_cents: 0,
                  line_total_ttc_cents: 8_000,
                },
              ],
              error: null,
            },
          },
        ],
        labor_roles: [
          {
            limit: {
              data: [
                { id: "atelier-role", hourly_rate_cents: 1_000 },
                { id: "chantier-role", hourly_rate_cents: 2_000 },
              ],
              error: null,
            },
          },
        ],
        // EST-E26 (T6, étape 11) : le split MO suit désormais le flag tenant réel
        // (comme le devis) et non plus une auto-détection locale du payload.
        feature_flags: [
          { maybeSingle: { data: { enabled: true }, error: null } },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireHubMarginAnalysis(PROJECT_ID);

    expect(result).not.toBeNull();
    expect(result?.global.costCents).toBe(8_000);
    expect(result?.global.saleCents).toBe(8_000);
    expect(result?.global.marginEurCents).toBe(0);
  });

  it("ignores the labor split payload when the tenant flag is disabled", async () => {
    // EST-E26 (T6, étape 11) : contrepartie du test précédent — sans le flag,
    // la ligne repasse en branche legacy (h_mo = 0) au lieu d'être auto-détectée.
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire MO Split OFF",
                reference: "AFF-SPLIT-OFF",
                client_name: "Client Split",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: [
                {
                  id: "v1",
                  project_id: PROJECT_ID,
                  version_number: 1,
                  status: "draft",
                  total_ht_cents: 8_000,
                  margin_multiplier: 1,
                  margin_mode: "fixed",
                  tax_rate_bp: 0,
                  discount_bp: 0,
                  discount_mode: "simple",
                  discount_steps: [],
                  global_coefficient: 1,
                  updated_at: "2026-03-05T08:00:00+00:00",
                },
              ],
              error: null,
            },
          },
        ],
        estimate_items: [
          {
            limit: {
              data: [
                {
                  id: "s1",
                  parent_id: null,
                  item_type: "section",
                  position: 1,
                  title: "Section 1",
                  description: null,
                },
                {
                  id: "l1",
                  parent_id: "s1",
                  item_type: "line",
                  position: 1,
                  title: "Ligne split",
                  description: null,
                  quantity: 1,
                  unit_price_ht_cents: 0,
                  tax_rate_bp: 0,
                  k_fo: 1,
                  h_mo: 0,
                  h_mo_majoration: 1,
                  k_mo: 1,
                  h_mo_atelier: 2,
                  k_mo_atelier: 1,
                  labor_role_atelier_id: "atelier-role",
                  h_mo_chantier: 3,
                  k_mo_chantier: 1,
                  labor_role_chantier_id: "chantier-role",
                  pu_ht_cents: 8_000,
                  labor_role_id: null,
                  category_id: null,
                  supply_type_id: null,
                  line_total_ht_cents: 8_000,
                  line_tax_cents: 0,
                  line_total_ttc_cents: 8_000,
                },
              ],
              error: null,
            },
          },
        ],
        labor_roles: [
          {
            limit: {
              data: [
                { id: "atelier-role", hourly_rate_cents: 1_000 },
                { id: "chantier-role", hourly_rate_cents: 2_000 },
              ],
              error: null,
            },
          },
        ],
        feature_flags: [
          { maybeSingle: { data: { enabled: false }, error: null } },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireHubMarginAnalysis(PROJECT_ID);

    expect(result).not.toBeNull();
    expect(result?.global.costCents).toBe(0);
    expect(result?.global.saleCents).toBe(0);
  });

  it("applies global coefficient to sale totals", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Coef",
                reference: "AFF-COEF",
                client_name: "Client Coef",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: [
                {
                  id: "v1",
                  project_id: PROJECT_ID,
                  version_number: 1,
                  status: "draft",
                  total_ht_cents: 12_000,
                  margin_multiplier: 1,
                  margin_mode: "fixed",
                  tax_rate_bp: 0,
                  discount_bp: 0,
                  discount_mode: "simple",
                  discount_steps: [],
                  global_coefficient: 1.2,
                  updated_at: "2026-03-05T08:00:00+00:00",
                },
              ],
              error: null,
            },
          },
        ],
        estimate_items: [
          {
            limit: {
              data: [
                {
                  id: "s1",
                  parent_id: null,
                  item_type: "section",
                  position: 1,
                  title: "Section 1",
                  description: null,
                },
                {
                  id: "l1",
                  parent_id: "s1",
                  item_type: "line",
                  position: 1,
                  title: "Ligne 1",
                  description: null,
                  quantity: 1,
                  unit_price_ht_cents: 10_000,
                  tax_rate_bp: 0,
                  k_fo: 1,
                  h_mo: 0,
                  h_mo_majoration: 1,
                  k_mo: 1,
                  h_mo_atelier: null,
                  k_mo_atelier: null,
                  labor_role_atelier_id: null,
                  h_mo_chantier: null,
                  k_mo_chantier: null,
                  labor_role_chantier_id: null,
                  pu_ht_cents: 10_000,
                  labor_role_id: null,
                  category_id: null,
                  supply_type_id: null,
                  line_total_ht_cents: 10_000,
                  line_tax_cents: 0,
                  line_total_ttc_cents: 10_000,
                },
              ],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireHubMarginAnalysis(PROJECT_ID);

    expect(result).not.toBeNull();
    expect(result?.global.costCents).toBe(10_000);
    expect(result?.global.saleCents).toBe(12_000);
    expect(result?.global.marginEurCents).toBe(2_000);
  });

  it("applies the global coefficient once on the total, not line by line", async () => {
    // EST-E26 (T6, étape 11) : 3 lignes à 3 333 c, coefficient 1,10.
    // AVANT : le coefficient était plié dans le multiplicateur de marge, donc
    // arrondi PAR LIGNE — Math.round(3333 x 1,1) = 3 666 x 3 = 10 998.
    // APRÈS : il s'applique une seule fois sur la somme —
    // bankersRound(9 999 x 1,1) = 10 999, réparti au centime sur les lignes.
    // C'est la dérive d'arrondi documentée (~4 EUR / 400 lignes).
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Arrondi",
                reference: "AFF-ARRONDI",
                client_name: "Client Arrondi",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: [
                {
                  id: "v1",
                  project_id: PROJECT_ID,
                  version_number: 1,
                  status: "draft",
                  total_ht_cents: 10_999,
                  margin_multiplier: 1,
                  margin_mode: "fixed",
                  tax_rate_bp: 0,
                  discount_bp: 0,
                  discount_mode: "simple",
                  discount_steps: [],
                  global_coefficient: 1.1,
                  updated_at: "2026-03-05T08:00:00+00:00",
                },
              ],
              error: null,
            },
          },
        ],
        estimate_items: [
          {
            limit: {
              data: [
                {
                  id: "s1",
                  parent_id: null,
                  item_type: "section",
                  position: 1,
                  title: "Section 1",
                  description: null,
                },
                ...[1, 2, 3].map((index) => ({
                  id: `l${index}`,
                  parent_id: "s1",
                  item_type: "line",
                  position: index,
                  title: `Ligne ${index}`,
                  description: null,
                  quantity: 1,
                  unit_price_ht_cents: 3_333,
                  tax_rate_bp: 0,
                  k_fo: 1,
                  h_mo: 0,
                  h_mo_majoration: 1,
                  k_mo: 1,
                  h_mo_atelier: null,
                  k_mo_atelier: null,
                  labor_role_atelier_id: null,
                  h_mo_chantier: null,
                  k_mo_chantier: null,
                  labor_role_chantier_id: null,
                  pu_ht_cents: 3_333,
                  labor_role_id: null,
                  category_id: null,
                  supply_type_id: null,
                  line_total_ht_cents: 3_333,
                  line_tax_cents: 0,
                  line_total_ttc_cents: 3_333,
                })),
              ],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireHubMarginAnalysis(PROJECT_ID);

    expect(result).not.toBeNull();
    expect(result?.global.costCents).toBe(9_999);
    expect(result?.global.saleCents).toBe(10_999);
    expect(result?.global.marginEurCents).toBe(1_000);
    // Invariant : la ventilation par lot somme EXACTEMENT au global.
    const sectionSaleSum = (result?.sections ?? []).reduce(
      (sum, section) => sum + section.saleCents,
      0
    );
    expect(sectionSaleSum).toBe(result?.global.saleCents);
    expect(result?.global.globalCoefficient).toBe(1.1);
    expect(result?.global.discountCents).toBe(0);
  });

  it("honours the tenant margin tiers when the version is in tiered mode", async () => {
    // EST-E26 (T6, étape 11) : le barème du tenant était ignoré au profit d'un
    // `marginMode: "fixed"` codé en dur. Coût 80 000 c, palier 1,35 => 108 000 c.
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Paliers",
                reference: "AFF-PALIERS",
                client_name: "Client Paliers",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: [
                {
                  id: "v1",
                  project_id: PROJECT_ID,
                  version_number: 1,
                  status: "draft",
                  total_ht_cents: 108_000,
                  margin_multiplier: 1,
                  margin_mode: "tiered",
                  tax_rate_bp: 0,
                  discount_bp: 0,
                  discount_mode: "simple",
                  discount_steps: [],
                  global_coefficient: 1,
                  updated_at: "2026-03-05T08:00:00+00:00",
                },
              ],
              error: null,
            },
          },
        ],
        estimate_items: [
          {
            limit: {
              data: [
                {
                  id: "s1",
                  parent_id: null,
                  item_type: "section",
                  position: 1,
                  title: "Section 1",
                  description: null,
                },
                {
                  id: "l1",
                  parent_id: "s1",
                  item_type: "line",
                  position: 1,
                  title: "Ligne 1",
                  description: null,
                  quantity: 1,
                  unit_price_ht_cents: 80_000,
                  tax_rate_bp: 0,
                  k_fo: 1,
                  h_mo: 0,
                  h_mo_majoration: 1,
                  k_mo: 1,
                  h_mo_atelier: null,
                  k_mo_atelier: null,
                  labor_role_atelier_id: null,
                  h_mo_chantier: null,
                  k_mo_chantier: null,
                  labor_role_chantier_id: null,
                  pu_ht_cents: 80_000,
                  labor_role_id: null,
                  category_id: null,
                  supply_type_id: null,
                  line_total_ht_cents: 108_000,
                  line_tax_cents: 0,
                  line_total_ttc_cents: 108_000,
                },
              ],
              error: null,
            },
          },
        ],
        margin_tiers: [
          {
            limit: {
              data: [{ threshold_cents: 0, multiplier: 1.35 }],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireHubMarginAnalysis(PROJECT_ID);

    expect(result).not.toBeNull();
    expect(result?.global.costCents).toBe(80_000);
    expect(result?.global.saleCents).toBe(108_000);
    expect(result?.global.marginMultiplier).toBe(1.35);
  });
});

// Lot 3.2 (entrée 4, D-d) : la carte et le résumé du hub montrent la marge des v3.
// V3C10 et V3P01 couvrent le navigateur ; ici, les choix de lecture et de repli.
describe("affaires hub v3 margin (lot 3.2)", () => {
  const V3_UPDATED_AT = "2026-10-24T08:00:00+00:00";
  const project = {
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    name: "Affaire v3",
    reference: "AFF-V3",
    client_name: "Client v3",
    is_archived: false,
  };

  function v3DraftRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "v3-draft",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      status: "draft",
      total_ht_cents: 11_000,
      margin_multiplier: 1,
      updated_at: V3_UPDATED_AT,
      calc_engine_version: 3,
      content_revision: 4,
      calc_snapshot_content_revision: null,
      calc_snapshot_context: null,
      ...overrides,
    };
  }

  function summaryContext(currentVersion: Record<string, unknown>) {
    return createHubContext({
      tableScenarios: {
        estimate_projects: [{ maybeSingle: { data: project, error: null } }],
        estimate_versions: [
          { limit: { data: null, count: 1, error: null } },
          { maybeSingle: { data: currentVersion, error: null } },
          { maybeSingle: { data: null, error: null } },
        ],
        estimate_items: [{ limit: { data: null, count: 1, error: null } }],
      },
    });
  }

  function v3Line(id: string, versionId: string) {
    return {
      id,
      version_id: versionId,
      parent_id: null,
      item_type: "line",
      position: 1,
      title: "Ligne v3",
      description: null,
      quantity: 1,
      unit_price_ht_cents: 10_000,
      tax_rate_bp: 2_000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: 1,
      k_mo: 1,
      h_mo_atelier: null,
      k_mo_atelier: null,
      labor_role_atelier_id: null,
      h_mo_chantier: null,
      k_mo_chantier: null,
      labor_role_chantier_id: null,
      pu_ht_cents: 13_000,
      labor_role_id: null,
      category_id: null,
      supply_type_id: null,
      line_total_ht_cents: 13_000,
      line_tax_cents: 2_600,
      line_total_ttc_cents: 15_600,
      unit_code: "u",
      pricing_status: "priced",
      h_mo_per_unit: 0,
      h_mo_atelier_per_unit: null,
      h_mo_chantier_per_unit: null,
    };
  }

  const v2Version = (id: string, versionNumber: number, marginMultiplier: number) => ({
    id,
    project_id: PROJECT_ID,
    version_number: versionNumber,
    status: "sent",
    total_ht_cents: 12_000,
    margin_multiplier: marginMultiplier,
    margin_mode: "fixed",
    tax_rate_bp: 0,
    discount_bp: 0,
    discount_mode: "simple",
    discount_steps: [],
    global_coefficient: 1,
    updated_at: V3_UPDATED_AT,
    calc_engine_version: 2,
  });

  const v3Version = (id: string, versionNumber: number, overrides: Record<string, unknown>) => ({
    id,
    project_id: PROJECT_ID,
    version_number: versionNumber,
    total_ht_cents: 13_000,
    margin_multiplier: 1,
    margin_mode: "fixed",
    tax_rate_bp: 2_000,
    discount_bp: 0,
    discount_amount_cents: null,
    discount_mode: "simple",
    discount_steps: [],
    global_coefficient: 1,
    updated_at: V3_UPDATED_AT,
    calc_engine_version: 3,
    rounding_mode: "none",
    rounding_step_cents: 1,
    contractor_role: "general_contractor",
    sale_coefficient_fo: 1.3,
    sale_coefficient_mo: 1,
    content_revision: 1,
    calc_snapshot_content_revision: null,
    calc_snapshot_context: null,
    ...overrides,
  });

  // V1 v2, V2 brouillon v3 sans gel, V3 v3 émise gelée, V4 v3 émise sans gel, V5 courante v2.
  function evolutionVersions() {
    return [
      v2Version("ev-1", 1, 1.15),
      v3Version("ev-2", 2, { status: "draft" }),
      v3Version("ev-3", 3, {
        status: "sent",
        total_ht_cents: 11_000,
        content_revision: 2,
        calc_snapshot_content_revision: 2,
        calc_snapshot_context: { engine: 3, cost_subtotal_cents: 10_000 },
      }),
      v3Version("ev-4", 4, { status: "sent" }),
      { ...v2Version("ev-5", 5, 1.2), status: "draft" },
    ];
  }

  const v2CurrentItems = [
    { id: "s1", parent_id: null, item_type: "section", position: 1, title: "Section 1", description: null },
    {
      ...v3Line("l1", "ev-5"),
      parent_id: "s1",
      unit_price_ht_cents: 10_000,
      tax_rate_bp: 0,
      pu_ht_cents: 12_000,
      line_total_ht_cents: 12_000,
      line_tax_cents: 0,
      line_total_ttc_cents: 12_000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadV3MarginEvidence).mockReset();
    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 0,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
    });
  });

  it("keeps the margin unavailable, never 0, when the live evidence fails or does not match", async () => {
    vi.mocked(getAuthenticatedContext).mockResolvedValue(summaryContext(v3DraftRow()) as never);
    vi.mocked(loadV3MarginEvidence).mockRejectedValueOnce(new Error("57014"));
    expect((await fetchAffaireHubSummary(PROJECT_ID)).currentVersion?.marginPercent).toBeNull();

    vi.mocked(getAuthenticatedContext).mockResolvedValue(summaryContext(v3DraftRow()) as never);
    vi.mocked(loadV3MarginEvidence).mockResolvedValueOnce({
      source: "authenticated_live",
      version: {
        id: "v3-draft",
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        status: "draft",
        content_revision: 5,
        updated_at: V3_UPDATED_AT,
      },
      net_ht_cents: 11_000,
      cost_subtotal_cents: 10_000,
    });
    expect((await fetchAffaireHubSummary(PROJECT_ID)).currentVersion?.marginPercent).toBeNull();
  });

  it("keeps the card when an earlier v3 draft cannot be read, and names that draft", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [{ maybeSingle: { data: project, error: null } }],
        estimate_versions: [{ limit: { data: evolutionVersions(), error: null } }],
        estimate_items: [
          { limit: { data: v2CurrentItems, error: null } },
          { limit: { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } },
        ],
      },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireHubMarginAnalysis(PROJECT_ID);

    expect(result?.global.saleCents).toBe(12_000);
    expect(result?.versionEvolution.map((point) => point.versionNumber)).toEqual([1, 3, 5]);
    expect(result?.versionEvolutionUnavailableV3).toEqual([2, 4]);
  });

  it("charts a current issued v3 at its fresh freeze, never at live tariffs, and names it without one", async () => {
    // Calculée en direct, la ligne donnerait 13 000 / 10 000, soit 30 % ; le gel dit 11 000 / 10 000, soit 10 %.
    const sectionId = "bbbbbbbb-bbbb-4bbb-8bbb-000000000030";
    const currentItems = [
      { id: sectionId, version_id: "ev-2", parent_id: null, item_type: "section", position: 1, title: "Lot", description: null },
      { ...v3Line("bbbbbbbb-bbbb-4bbb-8bbb-000000000031", "ev-2"), parent_id: sectionId },
    ];
    const frozen = v3Version("ev-2", 2, {
      status: "sent",
      total_ht_cents: 11_000,
      content_revision: 2,
      calc_snapshot_content_revision: 2,
      calc_snapshot_context: { engine: 3, cost_subtotal_cents: 10_000 },
    });
    const contextFor = (current: Record<string, unknown>) => createHubContext({
      tableScenarios: {
        estimate_projects: [{ maybeSingle: { data: project, error: null } }],
        estimate_versions: [{ limit: { data: [v2Version("ev-1", 1, 1.15), current], error: null } }],
        estimate_items: [{ limit: { data: currentItems, error: null } }],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(contextFor(frozen) as never);
    const issued = await fetchAffaireHubMarginAnalysis(PROJECT_ID);
    expect(issued?.versionEvolution.map((point) => [point.versionNumber, Number(point.marginPercent.toFixed(1))]))
      .toEqual([[1, 15], [2, 10]]);
    expect(issued?.versionEvolutionUnavailableV3).toBeUndefined();

    vi.mocked(getAuthenticatedContext).mockResolvedValue(contextFor(v3Version("ev-2", 2, { status: "sent" })) as never);
    const stale = await fetchAffaireHubMarginAnalysis(PROJECT_ID);
    expect(stale?.versionEvolution.map((point) => point.versionNumber)).toEqual([1]);
    expect(stale?.versionEvolutionUnavailableV3).toEqual([2]);
  });
});

// Isolation exception: LEGCUR02 covers the real browser, persistence and UI.
// The App Router performs this RPC and its follow-up PostgREST read on the
// server; browser routing cannot hold either internal request without replacing
// the rendered server result. Control that database schedule at the existing
// reader boundary here, while exercising the real fetchAffaireList function.
// Failure modes: (1) a save changes a listed version between the two reads,
// (2) the second read returns an unsupported currency, (3) a listed version is
// absent from it. None may fail the whole page (PR83 review: one autosave made
// the list route throw), none may pair the RPC amount with a later save's
// currency, and the other rows, their exact amounts/currencies and the page
// cursor must stay intact. A failed currency query itself remains an error.
describe("affaires list currency snapshot race", () => {
  it("withholds only the raced amount and keeps the rest of the page when a save lands between the reads", async () => {
    const raced = buildAffaireRow(1, { current_total_ht_cents: 1000 });
    const invalid = buildAffaireRow(2, { current_total_ht_cents: 2000 });
    const vanished = buildAffaireRow(3, { current_total_ht_cents: 3000 });
    const stable = buildAffaireRow(4, { current_total_ht_cents: 123456 });
    const fillers = Array.from({ length: 16 }, (_, index) => buildAffaireRow(index + 6));
    const overflow = buildAffaireRow(5, { current_total_ht_cents: 5000 });
    const schedule: string[] = [];
    const context = createContext({ role: "engineer" });
    context.supabase.rpc.mockImplementation(async () => {
      schedule.push("RPC: version 1 total 1000 before the save");
      return { data: [stable, invalid, vanished, ...fillers, raced, overflow], error: null };
    });
    const versionRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockImplementation(async () => {
        schedule.push("PostgREST: version 1 USD/2000 after an atomic save");
        return {
          data: [
            { id: raced.current_version_id, currency: "USD", total_ht_cents: 2000 },
            { id: invalid.current_version_id, currency: "XXX", total_ht_cents: 2000 },
            { id: stable.current_version_id, currency: "USD", total_ht_cents: 123456 },
            ...fillers.map((row) => ({ id: row.current_version_id, currency: "EUR", total_ht_cents: row.current_total_ht_cents })),
          ],
          error: null,
        };
      }),
    };
    context.supabase.from.mockImplementation(() => versionRead as never);
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireList({ size: 20, sort: "totalHtCents", dir: "asc" });

    expect(schedule).toEqual([
      "RPC: version 1 total 1000 before the save",
      "PostgREST: version 1 USD/2000 after an atomic save",
    ]);
    expect(result.items.map((item) => ({
      id: item.currentVersionId, total: item.currentTotalHtCents, currency: item.currentCurrency,
      status: item.currentStatus, name: item.projectName,
    }))).toEqual([
      { id: stable.current_version_id, total: 123456, currency: "USD", status: "draft", name: "Projet 4" },
      { id: invalid.current_version_id, total: null, currency: null, status: "draft", name: "Projet 2" },
      { id: vanished.current_version_id, total: null, currency: null, status: "draft", name: "Projet 3" },
      ...fillers.map((row) => ({ id: row.current_version_id, total: row.current_total_ht_cents, currency: "EUR",
        status: "draft", name: row.project_name })),
      { id: raced.current_version_id, total: null, currency: null, status: "draft", name: "Projet 1" },
    ]);
    expect(result.hasNextPage).toBe(true);
    // The keyset cursor still continues from the RPC's own row, not the withheld amount.
    expect(JSON.parse(Buffer.from(result.nextCursor!.replace(/-/g, "+").replace(/_/g, "/"), "base64")
      .toString("utf8"))).toMatchObject({ sort: "totalHtCents", value: 1000, projectId: raced.project_id });
  });

  it("still fails when the currency query itself fails", async () => {
    const listed = buildAffaireRow(1, { current_total_ht_cents: 1000 });
    const context = createContext({ role: "engineer", rpcResult: { data: [listed], error: null } });
    const versionRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement" } }),
    };
    context.supabase.from.mockImplementation(() => versionRead as never);
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(fetchAffaireList({ size: 20 })).rejects.toMatchObject({
      status: 400, code: "BAD_REQUEST", message: "Impossible de charger les devises des affaires.",
    });
  });

  it("keeps the same-version USD currency and exact RPC amount when the second read is coherent", async () => {
    const listed = buildAffaireRow(1, { current_total_ht_cents: 123456 });
    const context = createContext({ role: "engineer", rpcResult: { data: [listed], error: null } });
    const versionRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ id: listed.current_version_id, currency: "USD", total_ht_cents: 123456 }], error: null,
      }),
    };
    context.supabase.from.mockImplementation(() => versionRead as never);
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireList({ size: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      currentVersionId: listed.current_version_id, currentCurrency: "USD", currentTotalHtCents: 123456,
    });
    expect(versionRead.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(versionRead.in).toHaveBeenCalledWith("id", [listed.current_version_id]);
  });
});

// UX15 reproduced a fatal Server Component render (digest 4170724324) when a
// save changed a recent version between the list RPC and currency enrichment.
// The dashboard renders only recent metadata and counters, not money. Browser
// routing cannot hold these two internal PostgREST reads without replacing the
// RSC result, so control that schedule at this existing server-reader boundary.
// UX15 and LEGCUR02 retain the real dashboard and financial UI assertions; the
// list race tests above must still refuse a mixed amount/currency snapshot.
describe("affaires dashboard metadata race", () => {
  it("keeps the dashboard metadata available during a concurrent currency save", async () => {
    const listed = Array.from({ length: 6 }, (_, index) => buildAffaireRow(index + 1));
    const context = createContext({ role: "engineer" });
    context.supabase.rpc.mockImplementation(async (functionName: string): Promise<RpcResult> => {
      if (functionName === "list_affaires_page") return { data: listed, error: null };
      if (functionName === "get_affaires_counters") return {
        data: [{ total_count: 6, filtered_count: 6, draft_count: 6, sending_count: 0,
          sent_count: 0, accepted_count: 0, archived_count: 0 }], error: null,
      };
      throw new Error(`Unexpected RPC: ${functionName}`);
    });
    // If a financial reread occurs, it sees the SAME first version after its
    // atomic save: USD/2000, whereas the earlier RPC contained total 1000.
    const versionRead = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: listed.map((row, index) => ({ id: row.current_version_id,
          currency: index === 0 ? "USD" : "EUR", total_ht_cents: index === 0 ? 2000 : row.current_total_ht_cents })),
        error: null,
      }),
    };
    context.supabase.from.mockImplementation(() => versionRead as never);
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const overview = await fetchAffaireDashboardOverview();

    // The dashboard renders no amount: it must not make the financial read at all.
    expect(context.supabase.from).not.toHaveBeenCalled();
    expect(versionRead.in).not.toHaveBeenCalled();
    // Exact projection prevents fixing availability by returning stale monetary
    // fields or a later currency attached to the RPC's earlier amount.
    expect(overview.recentAffaires).toEqual(listed.slice(0, 5).map((row) => ({
      projectId: row.project_id, projectName: row.project_name,
      projectReference: row.project_reference, projectClient: row.project_client,
      currentStatus: row.current_status, currentUpdatedAt: row.current_updated_at,
    })));
    expect(overview.counters).toEqual({
      totalCount: 6, filteredCount: 6,
      statusCounts: { draft: 6, sending: 0, sent: 0, accepted: 0, archived: 0 },
    });
  });
});
