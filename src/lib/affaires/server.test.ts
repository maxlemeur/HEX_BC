import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { ApiError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import { fetchTakeoffDpgfSummaryForHub } from "@/lib/takeoff/server";
import {
  getEstimateSendGating,
  getEstimateSupplierComparisons,
  listEstimateItems,
  listEstimateProjectVersions,
} from "@/lib/estimates/server";
import { normalizeAffaireListQuery, parseAffaireListQuery } from "@/lib/affaires/schemas";
import {
  buildAffaireHubReadinessSnapshot,
  buildAffaireSubmissionReadinessSnapshot,
  fetchAffaireCounters,
  fetchAffaireDashboardOverview,
  fetchAffaireHubDpgfSource,
  fetchAffaireHubFinishLineSummary,
  fetchAffaireHubMarginAnalysis,
  fetchAffaireHubPlansSummary,
  fetchAffaireHubPageData,
  fetchAffaireHubSummary,
  fetchAffaireHubTimeline,
  fetchAffaireList,
  fetchAffaireManagerQueueSummary,
  fetchAffairePageData,
  fetchProjectVersionList,
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
      from: vi.fn(),
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

    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.in.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
    builder.range.mockReturnValue(builder);
    builder.maybeSingle.mockImplementation(
      async () => scenario.maybeSingle ?? defaultResult
    );
    builder.then = (onfulfilled, onrejected) =>
      Promise.resolve(scenario.limit ?? defaultResult).then(onfulfilled, onrejected);

    return builder;
  });
}

function createHubContext(options: {
  role?: TenantRole;
  tableScenarios: Record<string, TableQueryScenario[]>;
}) {
  return {
    supabase: {
      rpc: vi.fn(),
      from: createFromMock(options.tableScenarios),
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

describe("affaires query schemas", () => {
  it("normalizes URL search params", () => {
    const params = new URLSearchParams();
    params.set("q", "  chantier alpha  ");
    params.set("size", "1000");
    params.set("sort", "amount");
    params.set("dir", "asc");
    params.set("cursor", "  cursor-value  ");
    params.set("favorites", "1");
    params.set("manager", "revalidation");
    params.append("status", "draft,accepted");
    params.append("status", " sent ");
    params.append("status", "INVALID");

    const query = parseAffaireListQuery(params);

    expect(query).toEqual({
      q: "chantier alpha",
      status: ["draft", "accepted", "sent"],
      favoritesOnly: true,
      manager: "revalidation",
      size: 1000,
      cursor: "cursor-value",
      sort: "updatedAt",
      dir: "asc",
    });
  });

  it("falls back to defaults on invalid inputs", () => {
    const query = normalizeAffaireListQuery({
      q: "   ",
      favorites: "not-true",
      size: "999",
      sort: "other-sort",
      dir: "upward",
      cursor: "   ",
      status: ["draft", "archived"],
    });

    expect(query).toEqual({
      q: null,
      status: ["draft", "archived"],
      favoritesOnly: false,
      manager: "all",
      size: 20,
      cursor: null,
      sort: "updatedAt",
      dir: "desc",
    });
  });
});

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

describe("affaires submission readiness contract", () => {
  it("normalizes readyToSend flags into grouped submission readiness", () => {
    const snapshot = buildAffaireSubmissionReadinessSnapshot({
      blockingFlags: [
        {
          key: "critical_missing_pieces",
          category: "documents",
          severity: "blocking",
          count: 2,
          item_ids: [],
          label: "Documents critiques manquants",
          description: "Pieces critiques ouvertes.",
        },
      ],
      warningFlags: [
        {
          key: "open_questions_pending",
          category: "register",
          severity: "warning",
          count: 1,
          item_ids: [],
          label: "Questions ouvertes a traiter",
          description: "Hypotheses ouvertes.",
        },
      ],
      checkedAt: "2026-03-14T10:00:00.000Z",
      stalePriceDays: 30,
      errorMessage: null,
    });

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.groups).toEqual([
      expect.objectContaining({
        category: "documents",
        blockerCount: 1,
        alertCount: 0,
      }),
      expect.objectContaining({
        category: "register",
        blockerCount: 0,
        alertCount: 1,
      }),
    ]);
  });

  it("reuses the finish line gating as canonical submission readiness", async () => {
    vi.mocked(getEstimateSendGating).mockResolvedValue({
      gating: {
        canSend: false,
        blockingFlags: [
          {
            key: "critical_missing_pieces",
            category: "documents",
            severity: "blocking",
            count: 1,
            item_ids: [],
            label: "Documents critiques manquants",
            description: "Pieces critiques ouvertes.",
          },
        ],
        warningFlags: [
          {
            key: "open_questions_pending",
            category: "register",
            severity: "warning",
            count: 1,
            item_ids: [],
            label: "Questions ouvertes a traiter",
            description: "Hypotheses ouvertes.",
          },
        ],
        stalePriceDays: 21,
        checkedAt: "2026-03-14T10:00:00.000Z",
      },
    } as never);

    const summary = await fetchAffaireHubFinishLineSummary("version-1");

    expect(summary.submissionReadiness).toMatchObject({
      status: "blocked",
      checkedAt: "2026-03-14T10:00:00.000Z",
      stalePriceDays: 21,
      groups: [
        expect.objectContaining({
          category: "documents",
          blockerCount: 1,
        }),
        expect.objectContaining({
          category: "register",
          alertCount: 1,
        }),
      ],
    });
    expect(summary.readyToSend.status).toBe("blocked");
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

  it("maps projects without current version as nullable fields", async () => {
    const row = buildAffaireRow(1, {
      version_count: 0,
      has_current_version: false,
      current_version_id: null,
      current_version_number: null,
      current_status: null,
      current_total_ht_cents: null,
    });
    const context = createContext({
      role: "engineer",
      rpcResult: {
        data: [row],
        error: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireList({ size: 20 });

    expect(result.items[0]).toMatchObject({
      projectId: row.project_id,
      hasCurrentVersion: false,
      currentVersionId: null,
      currentVersionNumber: null,
      currentStatus: null,
      currentTotalHtCents: null,
      currentUpdatedAt: row.current_updated_at,
    });
  });

  it("passes admin scope with null owner", async () => {
    const context = createContext({
      role: "admin",
      rpcResult: {
        data: [buildAffaireRow(1)],
        error: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await fetchAffaireList({ size: 20 });

    expect(context.supabase.rpc).toHaveBeenCalledWith(
      "list_affaires_page",
      expect.objectContaining({
        p_owner_user_id: null,
        p_favorites_only: false,
        p_sort_dir: "desc",
      })
    );
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

  it("rejects invalid cursors", async () => {
    const context = createContext({ role: "engineer" });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(
      fetchAffaireList({ cursor: "###invalid###" })
    ).rejects.toBeInstanceOf(ApiError);

    await fetchAffaireList({ cursor: "###invalid###" }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      if (error instanceof ApiError) {
        expect(error.code).toBe("BAD_REQUEST");
      }
    });
  });

  it("fetches counters and maps status buckets", async () => {
    const context = createContext({
      role: "engineer",
      rpcResult: {
        data: [
          {
            total_count: 12,
            filtered_count: 6,
            draft_count: 4,
            sending_count: 1,
            sent_count: 1,
            accepted_count: 2,
            archived_count: 0,
          },
        ],
        error: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const counters = await fetchAffaireCounters({
      q: "projet",
      status: ["draft", "accepted"],
    });

    expect(context.supabase.rpc).toHaveBeenCalledWith("get_affaires_counters", {
      p_tenant_id: TENANT_ID,
      p_owner_user_id: USER_ID,
      p_search: "projet",
      p_statuses: ["draft", "accepted"],
      p_favorites_only: false,
    });

    expect(counters).toEqual({
      totalCount: 12,
      filteredCount: 6,
      statusCounts: {
        draft: 4,
        sending: 1,
        sent: 1,
        accepted: 2,
        archived: 0,
      },
    });
  });

  it("fetches list + counters in parallel from a single auth context", async () => {
    const context = createContext({ role: "engineer" });

    context.supabase.rpc.mockImplementation(
      async (fnName: string): Promise<RpcResult> => {
        if (fnName === "list_affaires_page") {
          return {
            data: [buildAffaireRow(1)],
            error: null,
          };
        }

        if (fnName === "get_affaires_counters") {
          return {
            data: [
              {
                total_count: 1,
                filtered_count: 1,
                draft_count: 1,
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
      }
    );

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffairePageData({ q: "Projet 1" });

    expect(getAuthenticatedContext).toHaveBeenCalledTimes(1);
    expect(context.supabase.rpc).toHaveBeenCalledTimes(2);
    expect(result.list.items).toHaveLength(1);
    expect(result.counters.totalCount).toBe(1);
  });

  it("bounds the dashboard overview query to five recent affaires", async () => {
    const context = createContext({ role: "engineer" });

    context.supabase.rpc.mockImplementation(
      async (fnName: string): Promise<RpcResult> => {
        if (fnName === "list_affaires_page") {
          return {
            data: Array.from({ length: 6 }, (_, index) =>
              buildAffaireRow(index + 1)
            ),
            error: null,
          };
        }

        if (fnName === "get_affaires_counters") {
          return {
            data: [
              {
                total_count: 18,
                filtered_count: 18,
                draft_count: 7,
                sending_count: 0,
                sent_count: 4,
                accepted_count: 5,
                archived_count: 2,
              },
            ],
            error: null,
          };
        }

        return { data: [], error: null };
      }
    );

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffaireDashboardOverview();

    expect(getAuthenticatedContext).toHaveBeenCalledTimes(1);
    expect(context.supabase.rpc).toHaveBeenCalledWith(
      "list_affaires_page",
      expect.objectContaining({
        p_limit: 6,
        p_sort_by: "updatedAt",
        p_sort_dir: "desc",
      })
    );
    expect(result.recentAffaires).toHaveLength(5);
    expect(result.recentAffaires.at(-1)?.projectName).toBe("Projet 5");
    expect(result.counters.totalCount).toBe(18);
  });

  it("passes favorites filter to list and counters and maps favorite rows", async () => {
    const context = createContext({
      role: "engineer",
      rpcResult: {
        data: [buildAffaireRow(1, { is_favorite: true })],
        error: null,
      },
    });

    context.supabase.rpc.mockImplementation(async (fnName: string) => {
      if (fnName === "list_affaires_page") {
        return {
          data: [buildAffaireRow(1, { is_favorite: true })],
          error: null,
        };
      }

      if (fnName === "get_affaires_counters") {
        return {
          data: [
            {
              total_count: 5,
              filtered_count: 1,
              draft_count: 1,
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

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const result = await fetchAffairePageData({ favorites: true });

    expect(context.supabase.rpc).toHaveBeenCalledWith(
      "list_affaires_page",
      expect.objectContaining({
        p_favorites_only: true,
      })
    );
    expect(context.supabase.rpc).toHaveBeenCalledWith(
      "get_affaires_counters",
      expect.objectContaining({
        p_favorites_only: true,
      })
    );
    expect(result.list.items[0]?.isFavorite).toBe(true);
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

  it("returns hub summary with current, accepted and line count", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Alpha",
                reference: "AFF-001",
                client_name: "Client Alpha",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: null,
              count: 3,
              error: null,
            },
          },
          {
            maybeSingle: {
              data: {
                id: "v3",
                project_id: PROJECT_ID,
                version_number: 3,
                status: "draft",
                total_ht_cents: 250_000,
                margin_multiplier: 1.18,
                updated_at: "2026-03-04T10:00:00+00:00",
              },
              error: null,
            },
          },
          {
            maybeSingle: {
              data: {
                id: "v2",
                project_id: PROJECT_ID,
                version_number: 2,
                status: "accepted",
                total_ht_cents: 220_000,
                margin_multiplier: 1.14,
                updated_at: "2026-03-03T09:00:00+00:00",
              },
              error: null,
            },
          },
        ],
        estimate_items: [
          {
            limit: {
              data: null,
              count: 42,
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubSummary(PROJECT_ID);

    expect(summary.project).toEqual({
      id: PROJECT_ID,
      name: "Affaire Alpha",
      reference: "AFF-001",
      clientName: "Client Alpha",
    });
    expect(summary.versionsCount).toBe(3);
    expect(summary.lineCount).toBe(42);
    expect(summary.currentVersion).toMatchObject({
      id: "v3",
      versionNumber: 3,
      status: "draft",
      totalHtCents: 250_000,
      marginMultiplier: 1.18,
    });
    expect(summary.acceptedVersion).toMatchObject({
      id: "v2",
      versionNumber: 2,
      status: "accepted",
    });
    expect(summary.structureContinuation).toMatchObject({
      canOpen: false,
      primarySourceKind: null,
      availableLots: [],
    });
    expect(summary.structureMode).toBeNull();
  });

  it("exposes the CCTP-based structure continuation contract in the hub summary", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Alpha",
                reference: "AFF-001",
                client_name: "Client Alpha",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: null,
              count: 1,
              error: null,
            },
          },
          {
            maybeSingle: {
              data: {
                id: "v3",
                project_id: PROJECT_ID,
                version_number: 3,
                status: "draft",
                total_ht_cents: 250_000,
                margin_multiplier: 1.18,
                updated_at: "2026-03-04T12:00:00+00:00",
              },
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
        estimate_items: [
          {
            limit: {
              data: null,
              count: 0,
              error: null,
            },
          },
          {
            limit: {
              data: [
                {
                  item_type: "line",
                  source_provider: "manual",
                },
              ],
              count: null,
              error: null,
            },
          },
        ],
        dpgf_imports: [
          {
            maybeSingle: {
              data: {
                id: "import-1",
                filename: "source.csv",
                source_format: "csv",
                status: "completed",
                created_at: "2026-03-04T08:00:00+00:00",
                parse_mode: "server",
                row_count: 33,
                tenant_id: TENANT_ID,
                project_id: PROJECT_ID,
              },
              error: null,
            },
          },
        ],
        dpgf_mappings: [
          {
            maybeSingle: {
              data: {
                id: "mapping-1",
                status: "validated",
                created_at: "2026-03-04T08:20:00+00:00",
                updated_at: "2026-03-04T08:21:00+00:00",
                tenant_id: TENANT_ID,
                import_id: "import-1",
              },
              error: null,
            },
          },
        ],
        dpgf_rows_mapped: [
          {
            limit: {
              data: null,
              count: 33,
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchAffaireIntakeWorkspace).mockResolvedValue({
      projectId: PROJECT_ID,
      uploadId: "upload-1",
      documents: [
        {
          documentId: "cctp-1",
          fileName: "cctp-principal.pdf",
          detectedCategory: "cctp",
          classificationStatus: "classified",
          documentPriority: "primary",
          confidence: 0.88,
          extractedMetadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: ["Electricite", "CVC"],
            detectedVariants: [],
          },
          issues: [],
        },
      ],
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
      briefDraft: {
        status: "a_confirmer",
        summary: "Brief en cours",
        projectObject: "Objet",
        scope: [],
        lots: [],
        receivedPieces: [],
        assumptions: [],
        vigilancePoints: [],
        missingElements: [],
        sources: [],
        uploadId: "upload-1",
        lastGeneratedAt: null,
        confirmedAt: null,
      },
    } as never);

    const summary = await fetchAffaireHubSummary(PROJECT_ID);

    expect(summary.structureContinuation).toMatchObject({
      canOpen: true,
      primarySourceKind: "primary_cctp",
      availableLots: ["Electricite", "CVC"],
      sources: [
        expect.objectContaining({
          kind: "primary_cctp",
          availability: "ready",
          fileName: "cctp-principal.pdf",
        }),
      ],
    });
    expect(summary.structureMode).toMatchObject({
      mode: "manual",
      manualLineCount: 1,
      importedLineCount: 0,
      canImportLinkedDpgfIntoCurrentStructure: true,
      linkedDpgfMappedRowCount: 33,
    });
    expect(summary.hubReadiness).toMatchObject({
      status: "ready_with_reservations",
      workingBasis: "established",
    });
  });

  it("returns summary with no versions and no accepted version", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Vide",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: null,
              count: 0,
              error: null,
            },
          },
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
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubSummary(PROJECT_ID);

    expect(summary.currentVersion).toBeNull();
    expect(summary.acceptedVersion).toBeNull();
    expect(summary.versionsCount).toBe(0);
    expect(summary.lineCount).toBe(0);
  });

  it("returns null DPGF source when no linked import exists", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Sans DPGF",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        dpgf_imports: [
          {
            maybeSingle: {
              data: null,
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const source = await fetchAffaireHubDpgfSource(PROJECT_ID);

    expect(source).toBeNull();
  });

  it("returns latest DPGF source and latest mapping status", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire DPGF",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        dpgf_imports: [
          {
            maybeSingle: {
              data: {
                id: "import-1",
                filename: "source.csv",
                source_format: "csv",
                status: "completed",
                created_at: "2026-03-04T08:00:00+00:00",
                parse_mode: "server",
                row_count: 33,
                tenant_id: TENANT_ID,
                project_id: PROJECT_ID,
              },
              error: null,
            },
          },
        ],
        dpgf_mappings: [
          {
            maybeSingle: {
              data: {
                id: "mapping-1",
                status: "validated",
                created_at: "2026-03-04T08:20:00+00:00",
                updated_at: "2026-03-04T08:21:00+00:00",
                tenant_id: TENANT_ID,
                import_id: "import-1",
              },
              error: null,
            },
          },
        ],
        dpgf_rows_mapped: [
          {
            limit: {
              data: null,
              count: 33,
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const source = await fetchAffaireHubDpgfSource(PROJECT_ID);

    expect(source).toEqual({
      importId: "import-1",
      filename: "source.csv",
      sourceFormat: "csv",
      importStatus: "completed",
      mappingStatus: "validated",
      importedAt: "2026-03-04T08:00:00+00:00",
      mappingUpdatedAt: "2026-03-04T08:21:00+00:00",
      parseMode: "server",
      rowCount: 33,
      mappedRowCount: 33,
    });
  });

  it("returns plans summary with latest takeoff job and item count", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Plans",
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
              data: null,
              count: 2,
              error: null,
            },
          },
        ],
        takeoff_jobs: [
          {
            maybeSingle: {
              data: {
                id: "job-1",
                status: "completed",
                level: "B",
                source_file_name: "Lot-CVC.pdf",
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-1",
              },
              error: null,
            },
          },
        ],
        plan_files: [
          {
            limit: {
              data: null,
              count: 2,
              error: null,
            },
          },
          {
            limit: {
              data: [{ file_size_bytes: 1200 }, { file_size_bytes: 3400 }],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(fetchTakeoffDpgfSummaryForHub).mockResolvedValue({
      reliable_matches: 5,
      to_confirm: 1,
      significant_gaps: 1,
      forced_manual: 0,
      lines_without_proof: 3,
      unused_takeoff_items: 0,
      total_lines: 10,
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary).toMatchObject({
      planSetCount: 2,
      planFileCount: 2,
      totalSizeBytes: 4600,
      defaultPlanSetId: null,
      defaultPlanSetName: null,
      defaultPlanSetFileCount: 0,
      defaultPlanSetUpdatedAt: null,
      latestJob: {
        jobId: "job-1",
        status: "review_required",
        label: "Revue requise",
        reviewVersionId: "ver-1",
        planSetId: null,
        estimateVersionId: "ver-1",
      },
      coveragePercent: 70,
      exceptionCount: 2,
      openQuestionsCount: 0,
      failureReasonLabel: null,
    });
    expect(summary.latestJob?.createdAt).toEqual(expect.any(String));
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

  it("keeps the auto-prompt job scoped to the default plan set", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Multi Jeux",
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
                  id: "set-a",
                  name: "Set A",
                  metadata: {
                    source: "affaire-intake",
                    default_import_plan_set: true,
                  },
                  estimate_version_id: "ver-current",
                  created_at: "2026-03-05T09:00:00+00:00",
                },
                {
                  id: "set-b",
                  name: "Set B",
                  metadata: {},
                  estimate_version_id: "ver-current",
                  created_at: "2026-03-06T09:00:00+00:00",
                },
              ],
              count: 2,
              error: null,
            },
          },
        ],
        takeoff_jobs: [
          {
            maybeSingle: {
              data: {
                id: "job-set-b",
                status: "completed",
                level: "B",
                processing_strategy: "sync",
                provider_batch_state: null,
                source_file_name: "set-b.pdf",
                created_at: "2026-03-07T10:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-current",
                plan_set_id: "set-b",
              },
              error: null,
            },
          },
          {
            maybeSingle: {
              data: {
                status: "completed",
                created_at: "2026-03-06T10:00:00+00:00",
                estimate_version_id: "ver-current",
                plan_set_id: "set-a",
              },
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
                  created_at: "2026-03-05T09:30:00+00:00",
                },
              ],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(fetchTakeoffDpgfSummaryForHub).mockResolvedValue({
      reliable_matches: 10,
      to_confirm: 0,
      significant_gaps: 0,
      forced_manual: 0,
      lines_without_proof: 0,
      unused_takeoff_items: 0,
      total_lines: 10,
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.latestJob).toMatchObject({
      jobId: "job-set-b",
      planSetId: "set-b",
    });
    expect(summary.defaultPlanSetLatestJob).toEqual({
      status: "completed",
      createdAt: "2026-03-06T10:00:00+00:00",
      estimateVersionId: "ver-current",
      planSetId: "set-a",
    });
  });

  it("returns empty plans summary when no plan set or job exists", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Sans Plans",
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
              data: null,
              count: 0,
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
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary).toEqual({
      planSetCount: 0,
      planFileCount: 0,
      totalSizeBytes: 0,
      hasLegacyFallback: false,
      defaultPlanSetId: null,
      defaultPlanSetName: null,
      defaultPlanSetSource: null,
      defaultPlanSetFileCount: 0,
      defaultPlanSetUpdatedAt: null,
      latestJob: null,
      coveragePercent: null,
      exceptionCount: null,
      openQuestionsCount: 0,
      failureReasonLabel: null,
    });
  });

  it("injects the register open questions count into the plans summary", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire registre",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            maybeSingle: {
              data: {
                id: "ver-9",
              },
              error: null,
            },
          },
        ],
        plan_sets: [
          {
            limit: {
              data: null,
              count: 0,
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
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 4,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
    });

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.openQuestionsCount).toBe(4);
    expect(vi.mocked(fetchAffaireRegisterGateSummary)).toHaveBeenCalledWith({
      supabase: context.supabase,
      projectId: PROJECT_ID,
      versionId: "ver-9",
    });
  });

  it("aggregates plan file sizes across multiple paged responses", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Plans Pagination",
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
              data: null,
              count: 1,
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
        ],
        plan_files: [
          {
            limit: {
              data: null,
              count: 3,
              error: null,
            },
          },
          {
            limit: {
              data: [{ file_size_bytes: 100 }, { file_size_bytes: 200 }],
              error: null,
            },
          },
          {
            limit: {
              data: [{ file_size_bytes: 300 }],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary).toEqual({
      planSetCount: 1,
      planFileCount: 3,
      totalSizeBytes: 600,
      hasLegacyFallback: false,
      defaultPlanSetId: null,
      defaultPlanSetName: null,
      defaultPlanSetSource: null,
      defaultPlanSetFileCount: 0,
      defaultPlanSetUpdatedAt: null,
      latestJob: null,
      coveragePercent: null,
      exceptionCount: null,
      openQuestionsCount: 0,
      failureReasonLabel: null,
    });
  });

  it("non-regression: keeps exact plan set count and full size sum beyond paged API limits", async () => {
    const firstPage = Array.from({ length: 500 }, () => ({ file_size_bytes: 10 }));
    const secondPage = Array.from({ length: 500 }, () => ({ file_size_bytes: 20 }));

    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Plans Non Regression",
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
              data: null,
              count: 1201,
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
        ],
        plan_files: [
          {
            limit: {
              data: null,
              count: 1001,
              error: null,
            },
          },
          {
            limit: {
              data: firstPage,
              error: null,
            },
          },
          {
            limit: {
              data: secondPage,
              error: null,
            },
          },
          {
            limit: {
              data: [{ file_size_bytes: 30 }],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary).toEqual({
      planSetCount: 1201,
      planFileCount: 1001,
      totalSizeBytes: 15030,
      hasLegacyFallback: false,
      defaultPlanSetId: null,
      defaultPlanSetName: null,
      defaultPlanSetSource: null,
      defaultPlanSetFileCount: 0,
      defaultPlanSetUpdatedAt: null,
      latestJob: null,
      coveragePercent: null,
      exceptionCount: null,
      openQuestionsCount: 0,
      failureReasonLabel: null,
    });
  });

  it("returns zero coverage/exceptions when job is pending", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Pending",
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
                id: "job-2",
                status: "pending",
                level: "A",
                source_file_name: null,
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-2",
              },
              error: null,
            },
          },
        ],
        plan_files: [
          { limit: { data: null, count: 1, error: null } },
          { limit: { data: [{ file_size_bytes: 500 }], error: null } },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.latestJob).toMatchObject({
      jobId: "job-2",
      status: "queued",
      label: "En file",
      reviewVersionId: "ver-2",
      planSetId: null,
      estimateVersionId: "ver-2",
    });
    expect(summary.coveragePercent).toBeNull();
    expect(summary.exceptionCount).toBeNull();
    expect(fetchTakeoffDpgfSummaryForHub).not.toHaveBeenCalled();
  });

  it("returns provider_pending status when a batch job is waiting on provider execution", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Provider Pending",
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
                id: "job-provider",
                status: "processing",
                level: "B",
                processing_strategy: "batch",
                provider_batch_state: "running",
                source_file_name: null,
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-provider",
              },
              error: null,
            },
          },
        ],
        plan_files: [
          { limit: { data: null, count: 1, error: null } },
          { limit: { data: [{ file_size_bytes: 200 }], error: null } },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.latestJob).toMatchObject({
      jobId: "job-provider",
      status: "provider_pending",
      label: "En attente provider",
      reviewVersionId: "ver-provider",
      planSetId: null,
      estimateVersionId: "ver-provider",
    });
  });

  it("returns failureReasonLabel when job has known error_code", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Failed",
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
                id: "job-3",
                status: "failed",
                level: "A",
                source_file_name: null,
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: "AI_TIMEOUT",
                error_message: "Timeout",
                estimate_version_id: "ver-3",
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

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.latestJob).toMatchObject({
      jobId: "job-3",
      status: "action_required",
      label: "Échec à corriger",
      reviewVersionId: "ver-3",
      planSetId: null,
      estimateVersionId: "ver-3",
    });
    expect(summary.failureReasonLabel).toBe(
      "Délai dépassé. Relancez l'analyse ou essayez un niveau plus rapide."
    );
  });

  it("returns null failureReasonLabel when error_code is unknown", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Failed Unknown",
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
                id: "job-4",
                status: "failed",
                level: "A",
                source_file_name: null,
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: "SOME_UNKNOWN_CODE",
                error_message: "Something",
                estimate_version_id: "ver-4",
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

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.failureReasonLabel).toBeNull();
  });

  it("returns review_required status when job is completed with exceptions", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Exceptions",
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
                id: "job-5",
                status: "completed",
                level: "B",
                source_file_name: null,
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-5",
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

    vi.mocked(fetchTakeoffDpgfSummaryForHub).mockResolvedValue({
      reliable_matches: 3,
      to_confirm: 2,
      significant_gaps: 1,
      forced_manual: 1,
      lines_without_proof: 2,
      unused_takeoff_items: 1,
      total_lines: 8,
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.latestJob?.status).toBe("review_required");
    expect(summary.latestJob?.label).toBe("Revue requise");
    expect(summary.coveragePercent).toBe(75);
    expect(summary.exceptionCount).toBe(5);
  });

  it("returns completed status when job is completed with zero exceptions", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Clean",
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
                id: "job-6",
                status: "completed",
                level: "B",
                source_file_name: null,
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-6",
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

    vi.mocked(fetchTakeoffDpgfSummaryForHub).mockResolvedValue({
      reliable_matches: 10,
      to_confirm: 0,
      significant_gaps: 0,
      forced_manual: 0,
      lines_without_proof: 0,
      unused_takeoff_items: 0,
      total_lines: 10,
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(summary.latestJob?.status).toBe("completed");
    expect(summary.latestJob?.label).toBe("Analyse terminée");
    expect(summary.coveragePercent).toBe(100);
    expect(summary.exceptionCount).toBe(0);
  });

  it("prefers the current linked version for the review CTA", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Carry Review",
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
                id: "job-carry",
                status: "completed",
                level: "A",
                source_file_name: "carry.pdf",
                created_at: "2026-03-05T11:00:00+00:00",
                error_code: null,
                error_message: null,
                estimate_version_id: "ver-source",
              },
              error: null,
            },
          },
        ],
        plan_files: [
          { limit: { data: null, count: 1, error: null } },
          { limit: { data: [{ file_size_bytes: 100 }], error: null } },
        ],
        estimate_versions: [
          {
            maybeSingle: {
              data: { id: "ver-target" },
              error: null,
            },
          },
        ],
        takeoff_version_links: [
          {
            maybeSingle: {
              data: { target_version_id: "ver-target" },
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(fetchTakeoffDpgfSummaryForHub).mockResolvedValue({
      reliable_matches: 1,
      to_confirm: 0,
      significant_gaps: 0,
      forced_manual: 0,
      lines_without_proof: 0,
      unused_takeoff_items: 0,
      total_lines: 1,
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const summary = await fetchAffaireHubPlansSummary(PROJECT_ID);

    expect(fetchTakeoffDpgfSummaryForHub).toHaveBeenCalledWith({
      supabase: context.supabase,
      tenantId: TENANT_ID,
      jobId: "job-carry",
      versionId: "ver-target",
      projectId: PROJECT_ID,
    });
    expect(summary.latestJob?.reviewVersionId).toBe("ver-target");
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

  it("returns NOT_FOUND when project is not accessible", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: null,
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    await expect(fetchAffaireHubSummary(PROJECT_ID)).rejects.toBeInstanceOf(ApiError);
    await fetchAffaireHubSummary(PROJECT_ID).catch((error: unknown) => {
      if (error instanceof ApiError) {
        expect(error.code).toBe("NOT_FOUND");
      }
    });
  });

  it("wraps project timeline fetch and validates page", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Timeline",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
      },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    vi.mocked(listEstimateProjectVersions).mockResolvedValue({
      items: [],
      pagination: {
        page: 2,
        page_size: 10,
        total_count: 0,
        total_pages: 1,
        has_prev: false,
        has_next: false,
      },
    });

    const timeline = await fetchAffaireHubTimeline(PROJECT_ID, 2);

    expect(listEstimateProjectVersions).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      page: 2,
    });
    expect(timeline.pagination.page).toBe(2);

    await expect(fetchAffaireHubTimeline(PROJECT_ID, 0)).rejects.toBeInstanceOf(ApiError);
  });

  it("paginates project version list beyond row cap for version filter options", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `v${index + 1}`,
      version_number: index + 1,
    }));

    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Versions",
                reference: null,
                client_name: null,
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: firstPage,
              error: null,
            },
          },
          {
            limit: {
              data: [{ id: "v1001", version_number: 1001 }],
              error: null,
            },
          },
          {
            limit: {
              data: [],
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);

    const versions = await fetchProjectVersionList(PROJECT_ID);

    expect(versions).toHaveLength(1001);
    expect(versions[0]).toEqual({ id: "v1", version_number: 1 });
    expect(versions.at(-1)).toEqual({ id: "v1001", version_number: 1001 });
  });

  it("aggregates hub page data with Promise.all", async () => {
    const context = createHubContext({
      tableScenarios: {
        estimate_projects: [
          {
            maybeSingle: {
              data: {
                id: PROJECT_ID,
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                name: "Affaire Hub",
                reference: "HUB-001",
                client_name: "Client Hub",
                is_archived: false,
              },
              error: null,
            },
          },
        ],
        estimate_versions: [
          {
            limit: {
              data: null,
              count: 1,
              error: null,
            },
          },
          {
            maybeSingle: {
              data: {
                id: "v1",
                project_id: PROJECT_ID,
                version_number: 1,
                status: "draft",
                total_ht_cents: 100_000,
                margin_multiplier: 1.1,
                updated_at: "2026-03-04T10:00:00+00:00",
              },
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
        estimate_items: [
          {
            limit: {
              data: null,
              count: 12,
              error: null,
            },
          },
        ],
        dpgf_imports: [
          {
            maybeSingle: {
              data: null,
              error: null,
            },
          },
        ],
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
    vi.mocked(listEstimateProjectVersions).mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        page_size: 10,
        total_count: 1,
        total_pages: 1,
        has_prev: false,
        has_next: false,
      },
    });

    const pageData = await fetchAffaireHubPageData(PROJECT_ID, 1);

    expect(pageData.summary.project.name).toBe("Affaire Hub");
    expect(pageData.summary.versionsCount).toBe(1);
    expect(pageData.summary.lineCount).toBe(12);
    expect(pageData.summary.hubReadiness).toMatchObject({
      status: "ready_with_reservations",
      briefStatus: "missing",
    });
    expect(pageData.timeline.pagination.page).toBe(1);
    expect(pageData.dpgfSource).toBeNull();
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
