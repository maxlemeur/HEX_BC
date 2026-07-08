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
    serverMocks.ok.mockImplementation((data: unknown) =>
      Response.json({
        ok: true,
        data,
      })
    );
    serverMocks.badRequest.mockImplementation((message: string) => {
      throw new Error(message);
    });
    serverMocks.requireTabularPdfReviewAccess.mockResolvedValue(undefined);
    serverMocks.validateTabularPdfReviewFile.mockResolvedValue(undefined);
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
    expect(serverMocks.requireTabularPdfReviewAccess).toHaveBeenCalledTimes(1);
    const validatedFile = serverMocks.validateTabularPdfReviewFile.mock
      .calls[0]?.[0] as File;
    expect(validatedFile.name).toBe("lot-cvc.pdf");
    expect(validatedFile.type).toBe("application/pdf");
    expect(validatedFile.size).toBe(file.size);
    expect(serverMocks.reviewTabularPdfImportFile).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDocumentId: "doc-1",
      })
    );
    expect(
      serverMocks.requireTabularPdfReviewAccess.mock.invocationCallOrder[0]
    ).toBeLessThan(
      serverMocks.reviewTabularPdfImportFile.mock.invocationCallOrder[0]
    );
    expect(
      serverMocks.validateTabularPdfReviewFile.mock.invocationCallOrder[0]
    ).toBeLessThan(
      serverMocks.reviewTabularPdfImportFile.mock.invocationCallOrder[0]
    );
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

  it("rejects invalid files before invoking the pdf parser", async () => {
    serverMocks.validateTabularPdfReviewFile.mockRejectedValueOnce(
      Object.assign(new Error("Le fichier doit etre un PDF."), {
        status: 415,
      })
    );

    const formData = new FormData();
    const file = new File(["not a pdf"], "notes.txt", {
      type: "text/plain",
    });
    formData.append("file", file);

    const response = await POST(
      new Request("http://localhost/api/imports/tabular-pdf/review-file", {
        method: "POST",
        body: formData,
      })
    );

    expect(response.status).toBe(415);
    const validatedFile = serverMocks.validateTabularPdfReviewFile.mock
      .calls[0]?.[0] as File;
    expect(validatedFile.name).toBe("notes.txt");
    expect(validatedFile.type).toBe("text/plain");
    expect(validatedFile.size).toBe(file.size);
    expect(serverMocks.reviewTabularPdfImportFile).not.toHaveBeenCalled();
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
