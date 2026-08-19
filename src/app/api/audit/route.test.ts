import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: vi.fn(),
}));

import { GET } from "@/app/api/audit/route";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { forbidden, unauthorized } from "@/lib/estimates/errors";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";

function mockTenantContext(supabase: unknown) {
  vi.mocked(getAuthenticatedTenantContext).mockResolvedValue({
    supabase,
    userId: USER_ID,
    tenantId: TENANT_ID,
    tenantRole: "admin",
    isTenantAdmin: true,
    membership: {
      id: "membership-1",
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role: "admin",
      is_default: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  } as AuthenticatedTenantContext);
}

function createAuditQuery(rows: Record<string, unknown>[] = []) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: undefined as PromiseLike<{ data: Record<string, unknown>[]; error: null }>["then"] | undefined,
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.then = ((onfulfilled, onrejected) =>
    Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected)) as typeof query.then;

  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== "audit_logs") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return query;
    }),
  };

  return { supabase, query };
}

describe("audit GET route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the user is not authenticated", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockRejectedValue(unauthorized());

    const response = await GET(new Request("http://localhost/api/audit"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when the user has no active tenant", async () => {
    vi.mocked(getAuthenticatedTenantContext).mockRejectedValue(
      forbidden("Aucun tenant actif pour cet utilisateur.")
    );

    const response = await GET(new Request("http://localhost/api/audit"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Aucun tenant actif pour cet utilisateur.",
    });
  });

  it("scopes audit logs to the active tenant", async () => {
    const rows = [
      {
        id: "log-1",
        created_at: "2026-08-01T00:00:00.000Z",
        user_id: USER_ID,
        table_name: "estimate_items",
        record_id: "item-1",
        estimate_version_id: ESTIMATE_VERSION_ID,
        action: "UPDATE",
        before_data: null,
        after_data: null,
      },
    ];
    const { supabase, query } = createAuditQuery(rows);
    mockTenantContext(supabase);

    const response = await GET(
      new Request(
        `http://localhost/api/audit?table_name=estimate_items&estimate_version_id=${ESTIMATE_VERSION_ID}&limit=10`
      )
    );

    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("audit_logs");
    expect(query.eq).toHaveBeenNthCalledWith(1, "tenant_id", TENANT_ID);
    expect(query.eq).toHaveBeenCalledWith("table_name", "estimate_items");
    expect(query.eq).toHaveBeenCalledWith(
      "estimate_version_id",
      ESTIMATE_VERSION_ID
    );
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(10);
    await expect(response.json()).resolves.toEqual({
      data: rows,
      meta: {
        count: 1,
        limit: 10,
        filters: {
          table_name: "estimate_items",
          estimate_version_id: ESTIMATE_VERSION_ID,
        },
        order: "created_at.desc",
      },
    });
  });

  it("rejects an invalid limit before querying", async () => {
    const { supabase, query } = createAuditQuery();
    mockTenantContext(supabase);

    const response = await GET(new Request("http://localhost/api/audit?limit=0"));

    expect(response.status).toBe(400);
    expect(query.select).not.toHaveBeenCalled();
  });
});
