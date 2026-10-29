import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/affaires/delete-server", () => ({
  bulkDeleteDraftAffaires: vi.fn(),
}));

import { DELETE } from "@/app/api/affaires/[projectId]/route";
import { bulkDeleteDraftAffaires } from "@/lib/affaires/delete-server";

const PROJECT_ID = "eb972cff-4870-4eb5-a079-f37f6fce42e9";

describe("DELETE /api/affaires/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not report success when the RPC returns a failed outcome", async () => {
    vi.mocked(bulkDeleteDraftAffaires).mockResolvedValue({
      requestedCount: 1,
      deletedIds: [],
      failures: [
        {
          projectId: PROJECT_ID,
          reason: "failed",
          message: "Impossible de supprimer cette affaire.",
        },
      ],
    });

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "INTERNAL_ERROR",
        message: "Impossible de supprimer cette affaire.",
      }),
    });
  });
});
