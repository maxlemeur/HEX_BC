import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { Database } from "@/types/database";

import { GET } from "./route";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

const TENANT = "10000000-0000-4000-8000-000000000001";
const AUTHOR = "20000000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-11-25T10:00:00.123456+00:00";
const ENDPOINT = "http://localhost/api/catalogue/import-batches";
const batchId = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("GET /api/catalogue/import-batches", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    "",
    "2026-11-25T10:00:00Z",
    `2026-02-30T10:00:00Z,${batchId(1)}`,
    `${CREATED_AT},not-a-uuid`,
    `${CREATED_AT},${batchId(1)},id.not.is.null`,
  ])("rejects a malformed cursor before querying: %j", async (cursor) => {
    const response = await GET(new Request(`${ENDPOINT}?${new URLSearchParams({ cursor })}`));

    expect(response.status).toBe(400);
    expect(getAuthenticatedTenantContext).not.toHaveBeenCalled();
  });

  it("pages through equal timestamps with tenant scope, visibility filtering and exact counts", async () => {
    const batches = Array.from({ length: 11 }, (_, index) => ({
      id: batchId(11 - index),
      kind: "workbook_articles",
      source_name: "classeur-exemple.xlsx",
      created_at: CREATED_AT,
      undo_started_at: null,
      undone_at: null,
      created_by: AUTHOR,
    }));
    const listRequests: URLSearchParams[] = [];
    const counts: URLSearchParams[] = [];
    const supabase = createClient<Database>("http://supabase.example", "fictional-key", {
      auth: { persistSession: false },
      global: { fetch: async (input) => {
        const { pathname, searchParams } = new URL(String(input));
        if (pathname.endsWith("/catalogue_import_batches")) {
          listRequests.push(searchParams);
          const rows = listRequests.length === 1 ? batches : batches.slice(10);
          return Response.json(rows);
        }
        counts.push(searchParams);
        const count = searchParams.has("catalogue_status") ? 2 : 3;
        return new Response(null, { headers: { "content-range": `*/${count}` } });
      } },
    });
    vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
      supabase,
      tenantId: TENANT,
      tenantRole: "engineer",
      userId: AUTHOR,
      isTenantAdmin: false,
      membership: { id: AUTHOR, tenant_id: TENANT, user_id: AUTHOR, role: "engineer", is_default: true, created_at: CREATED_AT, updated_at: CREATED_AT },
    });

    const first = await GET(new Request(ENDPOINT));
    expect(first.status).toBe(200);
    const { data: firstPage } = await first.json();
    expect(firstPage.items.map(({ id }: { id: string }) => id)).toEqual(batches.slice(0, 10).map(({ id }) => id));
    expect(firstPage.items[0]).toMatchObject({ total: 3, open: 2, can_undo: true });
    expect(firstPage.next_cursor).toBe(`${CREATED_AT},${batchId(2)}`);
    expect(counts).toHaveLength(20);

    const second = await GET(new Request(`${ENDPOINT}?${new URLSearchParams({ cursor: firstPage.next_cursor })}`));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ data: { items: [{ id: batchId(1), total: 3, open: 2, can_undo: true }], next_cursor: null } });
    expect(counts).toHaveLength(22);
    for (const params of [...listRequests, ...counts]) {
      expect(params.get("tenant_id")).toBe(`eq.${TENANT}`);
    }
    for (const params of listRequests) {
      expect(params.get("order")).toBe("created_at.desc,id.desc");
      expect(params.get("limit")).toBe("11");
      expect(params.get("select")).toContain("products!products_import_batch_fkey()");
      expect(params.getAll("or")[0]).toBe("(kind.neq.workbook_articles,undo_started_at.not.is.null,undone_at.not.is.null,products.not.is.null)");
    }
    expect(listRequests[1].getAll("or")[1]).toBe(
      `(created_at.lt.${CREATED_AT},and(created_at.eq.${CREATED_AT},id.lt.${batchId(2)}))`,
    );
  });
});
