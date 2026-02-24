import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/health/route";
import { forbidden } from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

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
        tenant_id: TENANT_ID,
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

describe("takeoff health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 when the takeoff module is enabled", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(vi.mocked(assertTakeoffEnabled)).toHaveBeenCalledWith(TENANT_ID, {
      supabase,
    });
  });

  it("returns 403 with normalized envelope when the module is disabled", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(assertTakeoffEnabled).mockRejectedValue(
      forbidden(
        "Le module Takeoff est desactive pour ce tenant.",
        undefined,
        "TAKEOFF_MODULE_DISABLED"
      )
    );

    const response = await GET();
    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
      };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("TAKEOFF_MODULE_DISABLED");
  });
});
