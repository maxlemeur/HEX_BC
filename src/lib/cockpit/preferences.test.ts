import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  getUserContext: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { getUserContext } from "@/lib/auth/server";
import { upsertCockpitCommandPreference } from "@/lib/cockpit/preferences";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function createSupabaseMock(error: { code: string; message: string } | null) {
  const upsert = vi.fn().mockResolvedValue({ error });

  return {
    from: vi.fn(() => ({
      upsert,
    })),
    upsert,
  };
}

describe("upsertCockpitCommandPreference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserContext).mockResolvedValue({
      tenantId: TENANT_ID,
      userEmail: "test@example.com",
      profile: {
        id: USER_ID,
        full_name: "Test User",
        phone: null,
        job_title: null,
        work_email: "test@example.com",
        role: "buyer",
        ui_mode: "expert",
        tenant_id: TENANT_ID,
        tenant_role: "engineer",
      },
    });
  });

  it("ignores missing table errors during rolling deploys", async () => {
    const supabase = createSupabaseMock({
      code: "42P01",
      message: "relation does not exist",
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      upsertCockpitCommandPreference({
        projectId: PROJECT_ID,
        actionId: "add-files",
        isHidden: false,
        isPinned: true,
      }),
    ).resolves.toBeUndefined();
    expect(supabase.upsert).toHaveBeenCalledOnce();
  });

  it("still throws unexpected Supabase errors", async () => {
    const error = {
      code: "42501",
      message: "permission denied",
    };
    const supabase = createSupabaseMock(error);

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      upsertCockpitCommandPreference({
        projectId: PROJECT_ID,
        actionId: "add-files",
        isHidden: true,
        isPinned: false,
      }),
    ).rejects.toEqual(error);
  });
});
