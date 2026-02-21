import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  listFeatureFlagsForTenant: vi.fn(),
  normalizeFeatureFlagKey: vi.fn((value: string) => value),
  toggleFeatureFlagForTenant: vi.fn(),
}));

import { GET } from "@/app/api/feature-flags/route";
import { listFeatureFlagsForTenant } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const EXPLICIT_TENANT_ID = "33333333-3333-4333-8333-333333333333";

function createSupabaseMock() {
  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: DEFAULT_TENANT_ID,
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  return {
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
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("feature-flags route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listFeatureFlagsForTenant).mockResolvedValue([] as never);
  });

  it("falls back to default tenant when tenant_id is omitted", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(new Request("http://localhost/api/feature-flags"));

    expect(response.status).toBe(200);
    expect(vi.mocked(listFeatureFlagsForTenant)).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: DEFAULT_TENANT_ID,
        userId: USER_ID,
        includeInactive: false,
      })
    );
  });

  it("returns 400 when tenant_id is invalid", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request("http://localhost/api/feature-flags?tenant_id=not-a-uuid")
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(listFeatureFlagsForTenant)).not.toHaveBeenCalled();
  });

  it("uses explicit tenant_id when provided", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request(`http://localhost/api/feature-flags?tenant_id=${EXPLICIT_TENANT_ID}`)
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(listFeatureFlagsForTenant)).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: EXPLICIT_TENANT_ID,
      })
    );
  });
});
