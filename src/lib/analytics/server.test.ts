import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  getUserContext: vi.fn(),
  getSupabase: vi.fn(),
}));

import { ApiError } from "@/lib/estimates/errors";
import { getSupabase, getUserContext } from "@/lib/auth/server";
import { fetchChiffreurAnalytics } from "@/lib/analytics/server";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ENGINEER_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

function createSupabaseMock() {
  return {
    rpc: vi.fn(),
  };
}

describe("fetchChiffreurAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns engineer-scoped analytics and hides owner options", async () => {
    const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const supabase = createSupabaseMock();

    vi.mocked(getUserContext).mockResolvedValue({
      userEmail: "engineer@test.com",
      tenantId,
      profile: {
        id: ENGINEER_ID,
        full_name: "Engineer User",
        phone: null,
        job_title: null,
        work_email: "engineer@test.com",
        role: "buyer",
        ui_mode: "expert",
        tenant_id: tenantId,
        tenant_role: "engineer",
      },
    });

    supabase.rpc.mockImplementation(async (fnName: string) => {
      if (fnName === "get_chiffreur_analytics_kpis") {
        return {
          data: [
            {
              active_affaires_count: 4,
              accepted_revenue_cents: 125000,
              accepted_versions_count: 5,
              sent_versions_count: 3,
              acceptance_rate: 62.55,
              avg_days_to_first_acceptance: 9.84,
            },
          ],
          error: null,
        };
      }

      if (fnName === "list_chiffreur_analytics_trend") {
        return {
          data: [
            { month_key: "2025-11", created_count: 1, accepted_count: 0 },
            { month_key: "2025-12", created_count: 2, accepted_count: 1 },
            { month_key: "2026-01", created_count: 3, accepted_count: 2 },
            { month_key: "2026-02", created_count: 4, accepted_count: 2 },
            { month_key: "2026-03", created_count: 5, accepted_count: 4 },
            { month_key: "2026-04", created_count: 6, accepted_count: 5 },
          ],
          error: null,
        };
      }

      if (fnName === "list_affaires_page") {
        return {
          data: [
            {
              project_id: "44444444-4444-4444-8444-444444444444",
              project_name: "Affaire Alpha",
              project_reference: "ALPHA-001",
              project_client: "Client A",
              version_count: 2,
              has_current_version: true,
              current_version_id: "55555555-5555-4555-8555-555555555555",
              current_version_number: 2,
              current_status: "sent",
              current_total_ht_cents: 120000,
              current_updated_at: "2026-03-01T10:00:00.000Z",
              accepted_version_id: "66666666-6666-4666-8666-666666666666",
              accepted_version_number: 1,
            },
          ],
          error: null,
        };
      }

      throw new Error(`Unexpected RPC call: ${fnName}`);
    });

    vi.mocked(getSupabase).mockResolvedValue(supabase as never);

    const result = await fetchChiffreurAnalytics();

    expect(result.scope).toEqual({
      mode: "owner",
      ownerUserId: ENGINEER_ID,
      isAdmin: false,
      viewerRole: "engineer",
    });

    expect(result.kpis).toEqual({
      activeAffaires: 4,
      acceptedRevenueCents: 125000,
      acceptedVersions: 5,
      sentVersions: 3,
      acceptanceRate: 62.5,
      avgDaysToFirstAcceptance: 9.8,
    });

    expect(result.trend).toHaveLength(6);
    expect(result.topAffaires).toHaveLength(1);
    expect(result.owners).toEqual([]);

    expect(supabase.rpc).toHaveBeenCalledWith("get_chiffreur_analytics_kpis", {
      p_tenant_id: tenantId,
      p_owner_user_id: ENGINEER_ID,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("list_chiffreur_analytics_trend", {
      p_tenant_id: tenantId,
      p_owner_user_id: ENGINEER_ID,
      p_months: 6,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("list_affaires_page", {
      p_tenant_id: tenantId,
      p_owner_user_id: ENGINEER_ID,
      p_limit: 10,
      p_search: null,
      p_statuses: null,
      p_cursor_updated_at: null,
      p_cursor_project_id: null,
      p_sort_dir: "desc",
    });
    expect(
      supabase.rpc.mock.calls.some((call) => call[0] === "list_chiffreur_analytics_owners")
    ).toBe(false);
  });

  it("rejects owner override for non-admin users", async () => {
    const tenantId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const supabase = createSupabaseMock();

    vi.mocked(getUserContext).mockResolvedValue({
      userEmail: "engineer@test.com",
      tenantId,
      profile: {
        id: ENGINEER_ID,
        full_name: "Engineer User",
        phone: null,
        job_title: null,
        work_email: "engineer@test.com",
        role: "buyer",
        ui_mode: "expert",
        tenant_id: tenantId,
        tenant_role: "engineer",
      },
    });

    vi.mocked(getSupabase).mockResolvedValue(supabase as never);

    await expect(
      fetchChiffreurAnalytics({ ownerUserId: OWNER_ID })
    ).rejects.toBeInstanceOf(ApiError);

    await fetchChiffreurAnalytics({ ownerUserId: OWNER_ID }).catch((error: unknown) => {
      const typed = error as ApiError;
      expect(typed.status).toBe(403);
      expect(typed.code).toBe("FORBIDDEN");
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("supports admin all-scope and owner-scope", async () => {
    const tenantId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const supabase = createSupabaseMock();

    vi.mocked(getUserContext).mockResolvedValue({
      userEmail: "admin@test.com",
      tenantId,
      profile: {
        id: ADMIN_ID,
        full_name: "Admin User",
        phone: null,
        job_title: null,
        work_email: "admin@test.com",
        role: "admin",
        ui_mode: "expert",
        tenant_id: tenantId,
        tenant_role: "admin",
      },
    });

    supabase.rpc.mockImplementation(async (fnName: string, args: Record<string, unknown>) => {
      if (fnName === "get_chiffreur_analytics_kpis") {
        return {
          data: [
            {
              active_affaires_count: args.p_owner_user_id ? 3 : 8,
              accepted_revenue_cents: args.p_owner_user_id ? 70000 : 270000,
              accepted_versions_count: args.p_owner_user_id ? 2 : 7,
              sent_versions_count: args.p_owner_user_id ? 1 : 3,
              acceptance_rate: args.p_owner_user_id ? 66.666 : 70,
              avg_days_to_first_acceptance: null,
            },
          ],
          error: null,
        };
      }

      if (fnName === "list_chiffreur_analytics_trend") {
        return {
          data: [
            { month_key: "2025-11", created_count: 1, accepted_count: 0 },
            { month_key: "2025-12", created_count: 1, accepted_count: 0 },
            { month_key: "2026-01", created_count: 1, accepted_count: 0 },
            { month_key: "2026-02", created_count: 1, accepted_count: 0 },
            { month_key: "2026-03", created_count: 1, accepted_count: 0 },
            { month_key: "2026-04", created_count: 1, accepted_count: 0 },
          ],
          error: null,
        };
      }

      if (fnName === "list_affaires_page") {
        return {
          data: [],
          error: null,
        };
      }

      if (fnName === "list_chiffreur_analytics_owners") {
        return {
          data: [
            {
              owner_user_id: OWNER_ID,
              owner_name: "Owner User",
              owner_role: "engineer",
              active_affaires_count: 3,
            },
            {
              owner_user_id: ADMIN_ID,
              owner_name: "Admin User",
              owner_role: "admin",
              active_affaires_count: 2,
            },
          ],
          error: null,
        };
      }

      throw new Error(`Unexpected RPC call: ${fnName}`);
    });

    vi.mocked(getSupabase).mockResolvedValue(supabase as never);

    const allScope = await fetchChiffreurAnalytics();
    expect(allScope.scope).toEqual({
      mode: "all",
      ownerUserId: null,
      isAdmin: true,
      viewerRole: "admin",
    });
    expect(allScope.kpis.acceptanceRate).toBe(70);
    expect(allScope.kpis.avgDaysToFirstAcceptance).toBeNull();
    expect(allScope.owners).toHaveLength(2);

    const ownerScope = await fetchChiffreurAnalytics({ ownerUserId: OWNER_ID });
    expect(ownerScope.scope).toEqual({
      mode: "owner",
      ownerUserId: OWNER_ID,
      isAdmin: true,
      viewerRole: "admin",
    });
    expect(ownerScope.kpis.acceptanceRate).toBe(66.7);

    expect(supabase.rpc).toHaveBeenCalledWith("get_chiffreur_analytics_kpis", {
      p_tenant_id: tenantId,
      p_owner_user_id: null,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("get_chiffreur_analytics_kpis", {
      p_tenant_id: tenantId,
      p_owner_user_id: OWNER_ID,
    });
  });

  it("rejects invalid ownerUserId format", async () => {
    const tenantId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    vi.mocked(getUserContext).mockResolvedValue({
      userEmail: "admin@test.com",
      tenantId,
      profile: {
        id: ADMIN_ID,
        full_name: "Admin User",
        phone: null,
        job_title: null,
        work_email: "admin@test.com",
        role: "admin",
        ui_mode: "expert",
        tenant_id: tenantId,
        tenant_role: "admin",
      },
    });

    await expect(
      fetchChiffreurAnalytics({ ownerUserId: "not-a-uuid" })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });
});
