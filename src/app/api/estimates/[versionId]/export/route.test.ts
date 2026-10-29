

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/estimates/export-stream", () => ({
  streamEstimateVersionXlsx: vi.fn(),
}));

vi.mock("@/lib/estimates/dpgf-export", () => ({
  streamEstimateVersionDpgfXlsx: vi.fn(),
}));

vi.mock("@/lib/estimates/bdc-export", () => ({
  streamEstimateVersionBdcV11Xlsx: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/export/route";
import { streamEstimateVersionXlsx } from "@/lib/estimates/export-stream";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";

function createSupabaseAuthMock(input: {
  userId?: string | null;
  role?: "admin" | "engineer" | "viewer";
}) {
  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data: input.role
      ? [
          {
            tenant_id: TENANT_ID,
            role: input.role,
            is_default: true,
            created_at: "2026-02-22T10:00:00.000Z",
          },
        ]
      : [],
    error: null,
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: input.userId ? { id: input.userId } : null,
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

describe("estimate export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when role is viewer", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseAuthMock({
        userId: USER_ID,
        role: "viewer",
      }) as never
    );

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/export`, {
        method: "GET",
      }),
      {
        params: Promise.resolve({ versionId: VERSION_ID }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "FORBIDDEN",
          message: "Export reserve aux rôles admin et engineer.",
        }),
      })
    );
    expect(vi.mocked(streamEstimateVersionXlsx)).not.toHaveBeenCalled();
  });
});
