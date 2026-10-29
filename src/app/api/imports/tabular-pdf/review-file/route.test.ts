import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  badRequest: vi.fn(),
  ok: vi.fn(),
  requireTabularPdfReviewAccess: vi.fn(),
  reviewTabularPdfImportFile: vi.fn(),
  toErrorResponse: vi.fn(),
  validateTabularPdfReviewFile: vi.fn(),
}));

vi.mock("@/lib/imports/server", () => serverMocks);

import { POST } from "@/app/api/imports/tabular-pdf/review-file/route";

describe("POST /api/imports/tabular-pdf/review-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverMocks.toErrorResponse.mockImplementation((error: unknown) => {
      const status =
        typeof (error as { status?: unknown }).status === "number"
          ? (error as { status: number }).status
          : 400;

      return Response.json(
        {
          ok: false,
          error: {
            message: error instanceof Error ? error.message : "Erreur",
          },
        },
        { status }
      );
    });
  });

  it("rejects unauthenticated callers before parsing multipart payloads", async () => {
    serverMocks.requireTabularPdfReviewAccess.mockRejectedValueOnce(
      Object.assign(new Error("Unauthorized"), {
        status: 401,
      })
    );
    const formData = vi.fn(async () => new FormData());

    const response = await POST({ formData } as unknown as Request);

    expect(response.status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
    expect(serverMocks.validateTabularPdfReviewFile).not.toHaveBeenCalled();
    expect(serverMocks.reviewTabularPdfImportFile).not.toHaveBeenCalled();
  });
});
