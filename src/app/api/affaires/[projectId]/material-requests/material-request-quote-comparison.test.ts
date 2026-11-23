import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./[requestId]/quotes/[quoteId]/files/[fileId]/comparison/route";

const ids = {
  projectId: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000002",
  quoteId: "00000000-0000-4000-8000-000000000003",
  fileId: "00000000-0000-4000-8000-000000000004",
};
const message = "Bonjour,\n- 100 u Rondelle M8\nMerci.";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  request: vi.fn(),
  quote: vi.fn(),
  file: vi.fn(),
  download: vi.fn(),
  prepare: vi.fn(),
  analyze: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/material-requests/server-shared", () => ({
  requireProjectAccess: mocks.authorize,
  requireRequest: mocks.request,
}));
vi.mock("@/lib/material-requests/quotes-server", () => ({ requireQuote: mocks.quote }));
vi.mock("@/lib/material-requests/document-analysis-server", () => ({
  prepareMaterialRequestDocumentAnalysis: mocks.prepare,
}));

const settings = { billingSource: "chatgpt_plan", preferences: { model: "demo", reasoningEffort: null } };

function post(input: unknown = settings) {
  return POST(new Request("http://localhost:3140/api/comparison", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }), { params: Promise.resolve(ids) });
}

function file(quoteId: string | null = ids.quoteId) {
  return {
    id: ids.fileId,
    quote_id: quoteId,
    storage_path: "fixture/quote.pdf",
    file_name: "example.pdf",
    mime_type: "application/pdf",
    byte_size: 500,
    stored_at: "2026-01-01T00:00:00Z",
    removed_at: null,
  };
}

describe("material request quote comparison route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mocks.file,
    };
    mocks.authorize.mockResolvedValue({
      project: { id: ids.projectId },
      context: {
        tenantId: "fixture-tenant",
        supabase: { from: () => query, storage: { from: () => ({ download: mocks.download }) } },
      },
    });
    mocks.request.mockResolvedValue({ id: ids.requestId });
    mocks.quote.mockResolvedValue({ id: ids.quoteId, message });
    mocks.file.mockResolvedValue({ data: file(), error: null });
    mocks.prepare.mockResolvedValue(mocks.analyze);
  });

  it("requires an explicit AI source before using either provider", async () => {
    expect((await post({})).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each([null, "00000000-0000-4000-8000-000000000005"])(
    "refuses an original or an attachment from another quote before accessing storage or sending it",
    async (quoteId) => {
      mocks.file.mockResolvedValue({ data: file(quoteId), error: null });
      const response = await post();
      expect(response.status).toBe(404);
      expect(mocks.authorize).toHaveBeenCalledWith(ids.projectId, "write");
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.analyze).not.toHaveBeenCalled();
    },
  );

  it("compares the authorized PDF with the sent message and counts explicit packs in code", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    mocks.download.mockResolvedValue({ data: new Blob([Buffer.from(await pdf.save())]), error: null });
    mocks.analyze.mockResolvedValue({
      model: "demo",
      data: {
        reference: "DEMO", revision: null, date: null, total_ht: null, commercial_notes: null,
        request_complete: true, document_complete: true, pages_read: [1, 2],
        requested: [[{ text: "100 u Rondelle M8", quantity: 100, unit: "u" }]],
        offered: [{
          text: "BTE 50 RONDELLES M8 · 1 UN", page: 2, row: 1, quantity: 1, unit: "UN",
          pack_quantity: 50, pack_unit: "u", requested_group: 1, technical: "compatible",
          observation: null, price: null, delay: null,
        }],
      },
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(mocks.download).toHaveBeenCalledWith("fixture/quote.pdf");
    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(JSON.stringify(message)),
      file: expect.objectContaining({ mimeType: "application/pdf" }),
    }));
    const output = await response.json();
    expect(output.data).toMatchObject({
      file_id: ids.fileId,
      complete: true,
      lines: [{ status: "short", requested_quantity: 100, offered_quantity: 50, difference: -50 }],
    });
  });
});
