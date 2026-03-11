import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMocks = vi.hoisted(() => ({
  badRequest: vi.fn(),
  ok: vi.fn(),
  reviewTabularPdfImportFile: vi.fn(),
  toErrorResponse: vi.fn(),
}));

vi.mock("@/lib/imports/server", () => serverMocks);

import { POST } from "@/app/api/imports/tabular-pdf/review-file/route";

describe("POST /api/imports/tabular-pdf/review-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serverMocks.ok.mockImplementation((data: unknown) =>
      Response.json({
        ok: true,
        data,
      })
    );
    serverMocks.badRequest.mockImplementation((message: string) => {
      throw new Error(message);
    });
    serverMocks.toErrorResponse.mockImplementation((error: unknown) =>
      Response.json(
        {
          ok: false,
          error: {
            message: error instanceof Error ? error.message : "Erreur",
          },
        },
        { status: 400 }
      )
    );
  });

  it("returns the tabular pdf file review payload", async () => {
    serverMocks.reviewTabularPdfImportFile.mockResolvedValue({
      review: {
        review_state: "light_validation",
      },
      tables: [],
    });

    const formData = new FormData();
    const file = new File(["%PDF-1.7"], "lot-cvc.pdf", {
      type: "application/pdf",
    });
    formData.append("file", file);
    formData.append("sourceDocumentId", "doc-1");

    const response = await POST(
      new Request("http://localhost/api/imports/tabular-pdf/review-file", {
        method: "POST",
        body: formData,
      })
    );

    expect(response.status).toBe(200);
    expect(serverMocks.reviewTabularPdfImportFile).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDocumentId: "doc-1",
      })
    );
  });

  it("returns a 400 when file is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/imports/tabular-pdf/review-file", {
        method: "POST",
        body: new FormData(),
      })
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: {
        message: "Aucun fichier PDF fourni.",
      },
    });
  });
});
