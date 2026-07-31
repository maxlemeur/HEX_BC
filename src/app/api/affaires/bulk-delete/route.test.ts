import { beforeEach, describe, expect, it, vi } from "vitest";

const bulkDeleteDraftAffairesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/affaires/delete-server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/affaires/delete-server")>();
  return {
    ...actual,
    bulkDeleteDraftAffaires: bulkDeleteDraftAffairesMock,
  };
});

import { POST } from "./route";

const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("POST /api/affaires/bulk-delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns each success and failure without widening the requested target", async () => {
    bulkDeleteDraftAffairesMock.mockResolvedValue({
      requestedCount: 2,
      deletedIds: [PROJECT_A],
      failures: [
        {
          projectId: PROJECT_B,
          reason: "not_eligible",
          message: "Affaire non eligible.",
        },
      ],
    });

    const response = await POST(
      new Request("http://localhost/api/affaires/bulk-delete", {
        method: "POST",
        body: JSON.stringify({
          projectIds: [PROJECT_A, PROJECT_B, PROJECT_A],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(bulkDeleteDraftAffairesMock).toHaveBeenCalledWith([
      PROJECT_A,
      PROJECT_B,
    ]);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        requestedCount: 2,
        deletedIds: [PROJECT_A],
        failures: [
          {
            projectId: PROJECT_B,
            reason: "not_eligible",
            message: "Affaire non eligible.",
          },
        ],
      },
    });
  });

  it("rejects empty or malformed selections before server deletion", async () => {
    const response = await POST(
      new Request("http://localhost/api/affaires/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ projectIds: [] }),
      })
    );

    expect(response.status).toBe(400);
    expect(bulkDeleteDraftAffairesMock).not.toHaveBeenCalled();
  });
});
