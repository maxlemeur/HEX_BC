import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from "@/app/api/tenants/memberships/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CURRENT_DEFAULT_MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const CURRENT_TENANT_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_TENANT_ID = "55555555-5555-4555-8555-555555555555";

describe("tenants memberships set-default regressions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the provided membership_id as the set-default target", async () => {
    const ownMemberships = [
      {
        id: CURRENT_DEFAULT_MEMBERSHIP_ID,
        tenant_id: CURRENT_TENANT_ID,
        user_id: USER_ID,
        role: "admin",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: TARGET_MEMBERSHIP_ID,
        tenant_id: TARGET_TENANT_ID,
        user_id: USER_ID,
        role: "admin",
        is_default: false,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];

    let selectCallCount = 0;
    const tenantMembershipsTable = {
      select: vi.fn(() => {
        selectCallCount += 1;

        if (selectCallCount === 1) {
          const actorBuilder = {
            eq: vi.fn(),
            order: vi.fn(),
            limit: vi.fn(),
          };

          actorBuilder.eq.mockReturnValue(actorBuilder);
          actorBuilder.order.mockReturnValue(actorBuilder);
          actorBuilder.limit.mockResolvedValue({
            data: [ownMemberships[0]],
            error: null,
          });

          return actorBuilder;
        }

        const targetMembershipBuilder = {
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              ...ownMemberships[1],
              is_default: true,
            },
            error: null,
          }),
        };

        targetMembershipBuilder.eq.mockReturnValue(targetMembershipBuilder);
        return targetMembershipBuilder;
      }),
    };

    const profilesTable = {
      select: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({
          data: [
            {
              id: USER_ID,
              full_name: "Admin User",
              work_email: "admin@example.com",
              job_title: "Admin",
            },
          ],
          error: null,
        }),
      })),
    };

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: USER_ID,
            },
          },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return tenantMembershipsTable;
        }

        if (table === "profiles") {
          return profilesTable;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: TARGET_MEMBERSHIP_ID,
        error: null,
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const request = new Request("http://localhost/api/tenants/memberships", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "set-default",
        membership_id: TARGET_MEMBERSHIP_ID,
      }),
    });

    const response = await POST(request);
    const body = (await response.json()) as {
      ok: boolean;
      data: {
        membership: {
          id: string;
          is_default: boolean;
        } | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.membership?.id).toBe(TARGET_MEMBERSHIP_ID);
    expect(body.data.membership?.is_default).toBe(true);

    expect(supabase.rpc).toHaveBeenCalledWith(
      "set_active_tenant_membership_default",
      { p_membership_id: TARGET_MEMBERSHIP_ID }
    );
  });
});
