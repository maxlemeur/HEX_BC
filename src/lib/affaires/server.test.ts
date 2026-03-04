import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
  listEstimateProjectVersions: vi.fn(),
}));

import { ApiError } from "@/lib/estimates/errors";
import {
  getAuthenticatedContext,
  listEstimateProjectVersions,
} from "@/lib/estimates/server";
import { normalizeAffaireListQuery, parseAffaireListQuery } from "@/lib/affaires/schemas";
import {
  fetchAffaireCounters,
  fetchAffaireHubDpgfSource,
  fetchAffaireHubPageData,
  fetchAffaireHubSummary,
  fetchAffaireHubTimeline,
  fetchAffaireList,
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
    const queue = tableScenarios[table];
    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected from() table call: ${table}`);
    }

    const scenario = queue.shift()!;
    const defaultResult: QueryResult = {
      data: null,
      error: null,
      count: null,
    };

    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn(),
      then: undefined as
        | ((onfulfilled?: (value: QueryResult) => unknown, onrejected?: (reason: unknown) => unknown) => Promise<unknown>)
        | undefined,
    };

    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
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
    params.set("size", "50");
    params.set("sort", "amount");
    params.set("dir", "asc");
    params.set("cursor", "  cursor-value  ");
    params.append("status", "draft,accepted");
    params.append("status", " sent ");
    params.append("status", "INVALID");

    const query = parseAffaireListQuery(params);

    expect(query).toEqual({
      q: "chantier alpha",
      status: ["draft", "accepted", "sent"],
      size: 50,
      cursor: "cursor-value",
      sort: "updatedAt",
      dir: "asc",
    });
  });

  it("falls back to defaults on invalid inputs", () => {
    const query = normalizeAffaireListQuery({
      q: "   ",
      size: "999",
      sort: "other-sort",
      dir: "upward",
      cursor: "   ",
      status: ["draft", "archived"],
    });

    expect(query).toEqual({
      q: null,
      status: ["draft", "archived"],
      size: 20,
      cursor: null,
      sort: "updatedAt",
      dir: "desc",
    });
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
      p_cursor_updated_at: null,
      p_cursor_project_id: null,
      p_sort_dir: "asc",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      projectId: row.project_id,
      projectName: row.project_name,
      hasCurrentVersion: true,
      currentVersionId: row.current_version_id,
      currentStatus: "draft",
    });
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
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
      updatedAt: string;
      projectId: string;
    };
    const lastVisibleItem = result.items[19]!;

    expect(decodedCursor).toEqual({
      updatedAt: lastVisibleItem.currentUpdatedAt,
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
            filtered_count: 7,
            draft_count: 4,
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
    });

    expect(counters).toEqual({
      totalCount: 12,
      filteredCount: 7,
      statusCounts: {
        draft: 4,
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
});

describe("affaires hub server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });
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
    expect(pageData.timeline.pagination.page).toBe(1);
    expect(pageData.dpgfSource).toBeNull();
  });
});
