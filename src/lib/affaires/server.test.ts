import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
}));

import { ApiError } from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { normalizeAffaireListQuery, parseAffaireListQuery } from "@/lib/affaires/schemas";
import {
  fetchAffaireCounters,
  fetchAffaireList,
  fetchAffairePageData,
} from "@/lib/affaires/server";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

type TenantRole = "admin" | "engineer" | "viewer";

type RpcResult = {
  data: unknown;
  error: null;
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
    },
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: options?.role ?? "engineer",
  };
}

function buildAffaireRow(index: number) {
  return {
    project_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    project_name: `Projet ${index}`,
    project_reference: `REF-${index}`,
    project_client: `Client ${index}`,
    version_count: 1,
    current_version_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    current_version_number: index,
    current_status: "draft" as const,
    current_total_ht_cents: 1_000 * index,
    current_updated_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T10:00:00+00:00`,
    accepted_version_id: null,
    accepted_version_number: null,
  };
}

describe("affaires query schemas", () => {
  it("normalizes URL search params", () => {
    const params = new URLSearchParams();
    params.set("q", "  chantier alpha  ");
    params.set("size", "50");
    params.set("sort", "amount");
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
    });
  });

  it("falls back to defaults on invalid inputs", () => {
    const query = normalizeAffaireListQuery({
      q: "   ",
      size: "999",
      sort: "other-sort",
      cursor: "   ",
      status: ["draft", "archived"],
    });

    expect(query).toEqual({
      q: null,
      status: ["draft", "archived"],
      size: 20,
      cursor: null,
      sort: "updatedAt",
    });
  });
});

describe("affaires server", () => {
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
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      projectId: row.project_id,
      projectName: row.project_name,
      currentVersionId: row.current_version_id,
      currentStatus: "draft",
    });
    expect(result.hasNextPage).toBe(false);
    expect(result.nextCursor).toBeNull();
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
