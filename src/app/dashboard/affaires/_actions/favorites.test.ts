import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  getUserContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { getUserContext } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toggleAffaireFavoriteAction } from "@/app/dashboard/affaires/_actions/favorites";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function createDeleteBuilder() {
  const builder = {
    eq: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);

  return builder;
}

describe("affaire favorites server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserContext).mockResolvedValue({
      tenantId: TENANT_ID,
      profile: {
        id: USER_ID,
      },
      userEmail: "test@example.com",
    } as never);
  });

  it("upserts a favorite and revalidates the affaires list", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: vi.fn(() => ({
        upsert,
      })),
    } as never);

    await toggleAffaireFavoriteAction({
      projectId: PROJECT_ID,
      isFavorite: true,
    });

    expect(upsert).toHaveBeenCalledWith(
      {
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        project_id: PROJECT_ID,
      },
      {
        onConflict: "tenant_id,user_id,project_id",
      }
    );
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
  });

  it("deletes a favorite and revalidates the affaires list", async () => {
    const deleteBuilder = createDeleteBuilder();
    deleteBuilder.eq
      .mockReturnValueOnce(deleteBuilder)
      .mockReturnValueOnce(deleteBuilder)
      .mockResolvedValueOnce({ error: null });

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: vi.fn(() => ({
        delete: vi.fn(() => deleteBuilder),
      })),
    } as never);

    await toggleAffaireFavoriteAction({
      projectId: PROJECT_ID,
      isFavorite: false,
    });

    expect(deleteBuilder.eq).toHaveBeenNthCalledWith(1, "tenant_id", TENANT_ID);
    expect(deleteBuilder.eq).toHaveBeenNthCalledWith(2, "user_id", USER_ID);
    expect(deleteBuilder.eq).toHaveBeenNthCalledWith(3, "project_id", PROJECT_ID);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/dashboard/affaires");
  });

  it("rejects invalid project ids", async () => {
    await expect(
      toggleAffaireFavoriteAction({
        projectId: "not-a-uuid",
        isFavorite: true,
      })
    ).rejects.toThrow("projectId invalide.");
  });
});
