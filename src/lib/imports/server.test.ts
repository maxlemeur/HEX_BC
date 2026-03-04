import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { listUserImports } from "@/lib/imports/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function createMembershipBuilder(role: "engineer" | "admin" = "engineer") {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: [{ tenant_id: TENANT_ID, role }],
    error: null,
  });

  return builder;
}

function createAwaitableImportsBuilder(data: unknown[] = []) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.then.mockImplementation((onFulfilled, onRejected) =>
    Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
  );

  return builder;
}

describe("listUserImports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid projectId before querying Supabase", async () => {
    await expect(
      listUserImports({
        projectId: "not-a-uuid",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });

    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("applies project_id filter when provided", async () => {
    const membershipBuilder = createMembershipBuilder();
    const importsBuilder = createAwaitableImportsBuilder([
      {
        id: "import-1",
      },
    ]);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") return membershipBuilder;
        if (table === "dpgf_imports") return importsBuilder;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await listUserImports({
      projectId: PROJECT_ID,
    });

    expect(importsBuilder.eq).toHaveBeenCalledWith("project_id", PROJECT_ID);
  });
});

