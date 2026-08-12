import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/estimates/v2-snapshot-server", () => ({
  freezeEstimateV2Snapshot: vi.fn(),
}));

import { freezeApprovalV2DraftIfRequired } from "@/lib/estimates/approval-v2-snapshot";
import { freezeEstimateV2Snapshot } from "@/lib/estimates/v2-snapshot-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("freezeApprovalV2DraftIfRequired", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the mandatory service-role seam to freeze a v2 draft for approval", async () => {
    const supabase = { name: "authenticated" };
    const serviceRole = { name: "service-role" };
    vi.mocked(createServiceRoleClient).mockReturnValue(serviceRole as never);
    vi.mocked(freezeEstimateV2Snapshot).mockResolvedValue({
      id: VERSION_ID,
      updated_at: "2026-03-01T09:01:00.000Z",
      content_revision: 12,
    });

    await expect(
      freezeApprovalV2DraftIfRequired(
        { supabase, tenantId: TENANT_ID, userId: USER_ID },
        {
          id: VERSION_ID,
          status: "draft",
          updated_at: "2026-03-01T09:00:00.000Z",
          content_revision: 11,
          calc_engine_version: 2,
        }
      )
    ).resolves.toBe(true);

    expect(createServiceRoleClient).toHaveBeenCalledOnce();
    expect(freezeEstimateV2Snapshot).toHaveBeenCalledWith({
      supabase,
      rpcClient: serviceRole,
      tenantId: TENANT_ID,
      versionId: VERSION_ID,
      expectedUpdatedAt: "2026-03-01T09:00:00.000Z",
      expectedContentRevision: 11,
      actorUserId: USER_ID,
      purpose: "approval",
    });
  });

  it("does not freeze a v1 draft", async () => {
    await expect(
      freezeApprovalV2DraftIfRequired(
        { supabase: {}, tenantId: TENANT_ID, userId: USER_ID },
        {
          id: VERSION_ID,
          status: "draft",
          updated_at: "2026-03-01T09:00:00.000Z",
          content_revision: 11,
          calc_engine_version: 1,
        }
      )
    ).resolves.toBe(false);

    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(freezeEstimateV2Snapshot).not.toHaveBeenCalled();
  });
});
