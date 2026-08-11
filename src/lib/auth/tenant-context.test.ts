import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { ApiError } from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  getAuthenticatedTenantContext,
  readActiveTenantMembership,
} from "./tenant-context";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function createSupabaseMock(input?: {
  user?: { id: string } | null;
  userError?: { name: string; message: string; status: number } | null;
  membership?: Record<string, unknown> | null;
  membershipError?: {
    code: string;
    message: string;
    details: string | null;
    hint: string | null;
  } | null;
}) {
  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data:
      input?.membership === null
        ? []
        : [
            input?.membership ?? {
              id: "membership-id",
              tenant_id: TENANT_ID,
              user_id: USER_ID,
              role: "admin",
              is_default: true,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
    error: input?.membershipError ?? null,
  });

  const select = vi.fn(() => membershipBuilder);
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: input?.user === undefined ? { id: USER_ID } : input.user },
        error: input?.userError ?? null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table !== "tenant_memberships") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return { select };
    }),
  };

  return { supabase, membershipBuilder, select };
}

describe("authenticated tenant context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects only active tenants with the canonical membership ordering", async () => {
    const { supabase, membershipBuilder, select } = createSupabaseMock();

    const result = await readActiveTenantMembership(supabase as never, USER_ID);

    expect(result.membership?.tenant_id).toBe(TENANT_ID);
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("tenants!inner(is_active)")
    );
    expect(membershipBuilder.eq).toHaveBeenNthCalledWith(1, "user_id", USER_ID);
    expect(membershipBuilder.eq).toHaveBeenNthCalledWith(
      2,
      "tenants.is_active",
      true
    );
    expect(membershipBuilder.order).toHaveBeenNthCalledWith(1, "is_default", {
      ascending: false,
    });
    expect(membershipBuilder.order).toHaveBeenNthCalledWith(2, "created_at", {
      ascending: true,
    });
    expect(membershipBuilder.limit).toHaveBeenCalledWith(1);
  });

  it("returns the active tenant, role, and membership from one strict boundary", async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const context = await getAuthenticatedTenantContext();

    expect(context).toMatchObject({
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
      isTenantAdmin: true,
      membership: { id: "membership-id" },
    });
    expect(context.supabase).toBe(supabase);
  });

  it("fails closed when authentication fails", async () => {
    const { supabase } = createSupabaseMock({ user: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getAuthenticatedTenantContext()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    } satisfies Partial<ApiError>);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("fails closed when the user has no active tenant", async () => {
    const { supabase } = createSupabaseMock({ membership: null });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getAuthenticatedTenantContext()).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Aucun tenant actif pour cet utilisateur.",
    } satisfies Partial<ApiError>);
  });

  it("maps membership lookup failures without selecting a fallback tenant", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { supabase } = createSupabaseMock({
      membershipError: {
        code: "XX000",
        message: "database unavailable",
        details: null,
        hint: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getAuthenticatedTenantContext()).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Impossible de charger le tenant courant.",
    } satisfies Partial<ApiError>);
    consoleError.mockRestore();
  });
});
