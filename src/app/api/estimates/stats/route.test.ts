import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET } from "@/app/api/estimates/stats/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type QueryResult<T> = {
  data: T;
  error: null;
};

type MembershipRow = {
  tenant_id: string;
  role: "admin" | "engineer" | "viewer";
  is_default: boolean;
  created_at: string;
};

type VersionRow = {
  id: string;
  status: "draft" | "sending" | "sent" | "accepted" | "archived";
  created_at: string;
  updated_at: string;
  total_ht_cents: number;
};

function monthDate(offsetMonths: number, day = 10) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, day)).toISOString();
}

function createMembershipQuery(result: QueryResult<MembershipRow[]>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(result),
  };
}

function createVersionsQuery(result: QueryResult<VersionRow[]>) {
  return {
    data: result.data,
    error: result.error,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
}

function createSupabaseMock(input: {
  membership: MembershipRow;
  versions: VersionRow[];
}) {
  const membershipQuery = createMembershipQuery({
    data: [input.membership],
    error: null,
  });
  const versionsQuery = createVersionsQuery({
    data: input.versions,
    error: null,
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: "user-1" },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQuery;
      }
      if (table === "estimate_versions") {
        return versionsQuery;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    membershipQuery,
    versionsQuery,
  };
}

describe("estimate stats route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies owner filter for non-admin users", async () => {
    const { supabase, versionsQuery } = createSupabaseMock({
      membership: {
        tenant_id: "tenant-1",
        role: "engineer",
        is_default: true,
        created_at: monthDate(-1, 1),
      },
      versions: [],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(versionsQuery.eq).toHaveBeenCalledWith("estimate_projects.user_id", "user-1");
  });
});
