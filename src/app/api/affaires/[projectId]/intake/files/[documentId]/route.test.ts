import { createHash } from "node:crypto";
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

import { getAffaireIntakeDpgfDownload, readAffaireIntakeDpgfFile } from "@/lib/affaires/intake-server";
import { notFound } from "@/lib/estimates/errors";
import { createImportFromMultipartFormData, reviewTabularPdfImportFile } from "@/lib/imports/server";
import { GET, POST } from "./route";

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

  it("propagates an inaccessible document as private, uncached data", async () => {
    vi.mocked(getAffaireIntakeDpgfDownload).mockRejectedValue(notFound("Document introuvable."));
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("points a Drive piece at the same route and streams its bytes as a private attachment", async () => {
    vi.mocked(getAffaireIntakeDpgfDownload).mockResolvedValue({ documentId } as never);
    expect((await GET(new Request(url), context)).status).toBe(200);
    expect(getAffaireIntakeDpgfDownload).toHaveBeenCalledWith(projectId, documentId, `${url}?content=1`);

    const file = new File(["drive bytes"], "DPGF lot 1.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    vi.mocked(readAffaireIntakeDpgfFile).mockResolvedValue(file);
    const response = await GET(new Request(`${url}?content=1`), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("drive bytes");
    expect(readAffaireIntakeDpgfFile).toHaveBeenCalledWith(projectId, documentId);
    expect(getAffaireIntakeDpgfDownload).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe(file.type);
    expect(response.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''DPGF%20lot%201.xlsx");

    vi.mocked(readAffaireIntakeDpgfFile).mockRejectedValue(notFound("Document introuvable."));
    const refused = await GET(new Request(`${url}?content=1`), context);
    expect(refused.status).toBe(404);
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
  });

  it("imports the server-read spreadsheet and its trusted document identity", async () => {
    const file = new File(["private copy"], "dpgf.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    vi.mocked(readAffaireIntakeDpgfFile).mockResolvedValue(file);
    vi.mocked(createImportFromMultipartFormData).mockResolvedValue({ id: "import" } as never);
    const response = await POST(request({ action: "import" }), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(readAffaireIntakeDpgfFile).toHaveBeenCalledWith(projectId, documentId);
    const [form, sourceId] = vi.mocked(createImportFromMultipartFormData).mock.calls[0];
    expect(form.get("file")).toBe(file);
    expect(form.get("projectId")).toBe(projectId);
    expect(sourceId).toBe(documentId);
  });

  it("requires approval for PDF content even when the filename has another extension", async () => {
    const file = new File(["%PDF-1.4"], "dpgf.xls", { type: "application/pdf" });
    vi.mocked(readAffaireIntakeDpgfFile).mockResolvedValue(file);
    const response = await POST(request({ action: "import" }), context);
    expect(response.status).toBe(400);
    expect(createImportFromMultipartFormData).not.toHaveBeenCalled();
  });

  it("ties PDF approval to the reviewed bytes and imports the stored copy", async () => {
    const file = new File(["%PDF-1.4"], "dpgf.pdf", { type: "application/pdf" });
    const tables = [{ page: 1, tableIndex: 0, headers: ["Désignation"], rows: [["Tube"]] }];
    vi.mocked(readAffaireIntakeDpgfFile).mockResolvedValue(file);
    vi.mocked(reviewTabularPdfImportFile).mockResolvedValue({ tables } as never);
    vi.mocked(createImportFromMultipartFormData).mockResolvedValue({ id: "import" } as never);
    const review = await POST(request({ action: "review_pdf" }), context);
    const digest = createHash("sha256").update("%PDF-1.4").digest("hex");
    expect((await review.json()).data.source_sha256).toBe(digest);
    expect((await POST(request({ action: "import", approvedTables: [{ sourcePage: 1, tableIndex: 0 }], sourceSha256: "0".repeat(64) }), context)).status).toBe(409);
    expect(createImportFromMultipartFormData).not.toHaveBeenCalled();
    const approved = [{ sourcePage: 1, tableIndex: 0 }];
    const response = await POST(request({ action: "import", approvedTables: approved, sourceSha256: digest }), context);
    expect(response.status).toBe(201);
    expect(reviewTabularPdfImportFile).toHaveBeenCalledWith({ file, sourceDocumentId: documentId });
    const [form, sourceId, selection] = vi.mocked(createImportFromMultipartFormData).mock.calls[0];
    expect(form.get("file")).toBe(file);
    expect(sourceId).toBe(documentId);
    expect(selection).toEqual(approved);
  });
});
