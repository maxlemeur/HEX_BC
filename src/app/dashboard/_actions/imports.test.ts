import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { linkImportToProject } from "@/app/dashboard/_actions/imports";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const IMPORT_ID = "44444444-4444-4444-8444-444444444444";

function createMembershipBuilder() {
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
    data: [{ tenant_id: TENANT_ID, role: "engineer" }],
    error: null,
  });

  return builder;
}

describe("linkImportToProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links an existing import to a project and revalidates paths", async () => {
    const membershipBuilder = createMembershipBuilder();

    const projectBuilder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    projectBuilder.select.mockReturnValue(projectBuilder);
    projectBuilder.eq.mockReturnValue(projectBuilder);
    projectBuilder.maybeSingle.mockResolvedValue({
      data: { id: PROJECT_ID },
      error: null,
    });

    const updateBuilder = {
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(),
    };
    updateBuilder.eq.mockReturnValue(updateBuilder);
    updateBuilder.select.mockReturnValue(updateBuilder);
    updateBuilder.maybeSingle.mockResolvedValue({
      data: { id: IMPORT_ID, project_id: PROJECT_ID },
      error: null,
    });

    const importsBuilder = {
      update: vi.fn().mockReturnValue(updateBuilder),
    };

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") return membershipBuilder;
        if (table === "estimate_projects") return projectBuilder;
        if (table === "dpgf_imports") return importsBuilder;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await linkImportToProject({
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
    });

    expect(result).toEqual({
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/imports");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/affaires/${PROJECT_ID}`);
  });

  it("supports unlinking project from import", async () => {
    const membershipBuilder = createMembershipBuilder();

    const updateBuilder = {
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn(),
    };
    updateBuilder.eq.mockReturnValue(updateBuilder);
    updateBuilder.select.mockReturnValue(updateBuilder);
    updateBuilder.maybeSingle.mockResolvedValue({
      data: { id: IMPORT_ID, project_id: null },
      error: null,
    });

    const importsBuilder = {
      update: vi.fn().mockReturnValue(updateBuilder),
    };

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

    const result = await linkImportToProject({
      importId: IMPORT_ID,
      projectId: null,
    });

    expect(result).toEqual({
      importId: IMPORT_ID,
      projectId: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/imports");
    expect(revalidatePath).not.toHaveBeenCalledWith(`/dashboard/affaires/${PROJECT_ID}`);
  });
});
