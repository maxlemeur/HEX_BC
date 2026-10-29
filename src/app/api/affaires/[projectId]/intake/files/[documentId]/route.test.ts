import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/affaires/intake-server", () => ({
  getAffaireIntakeDpgfDownload: vi.fn(),
  readAffaireIntakeDpgfFile: vi.fn(),
}));
vi.mock("@/lib/imports/server", () => ({
  ImportsApiError: class ImportsApiError extends Error {},
  toErrorResponse: vi.fn(() => new Response(null, { status: 400 })),
  createImportFromJsonBody: vi.fn(),
  createImportFromMultipartFormData: vi.fn(),
  reviewTabularPdfImportFile: vi.fn(),
  validateTabularPdfReviewFile: vi.fn(),
}));

import { readAffaireIntakeDpgfFile } from "@/lib/affaires/intake-server";
import { createImportFromMultipartFormData } from "@/lib/imports/server";
import { POST } from "./route";

const projectId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ projectId, documentId }) };
const url = `http://localhost:3000/api/affaires/${projectId}/intake/files/${documentId}`;
const request = (body: unknown, origin = "http://localhost:3000") => new Request(url, {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});

afterEach(() => vi.resetAllMocks());

describe("dossier DPGF HTTP boundary", () => {
  it("refuses a foreign, oversized or forged action before reading the document", async () => {
    expect((await POST(request({ action: "import" }, "https://example.invalid"), context)).status).toBe(400);
    expect((await POST(request({ action: "import", pad: "x".repeat(17 * 1024) }), context)).status).toBe(400);
    expect((await POST(request({ action: "import", rows: [{ price: 1 }] }), context)).status).toBe(400);
    expect(readAffaireIntakeDpgfFile).not.toHaveBeenCalled();
  });

  it("requires approval for PDF content even when the filename has another extension", async () => {
    const file = new File(["%PDF-1.4"], "dpgf.xls", { type: "application/pdf" });
    vi.mocked(readAffaireIntakeDpgfFile).mockResolvedValue(file);
    const response = await POST(request({ action: "import" }), context);
    expect(response.status).toBe(400);
    expect(createImportFromMultipartFormData).not.toHaveBeenCalled();
  });
});
