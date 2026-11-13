import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/intake-server", () => ({ requireAffaireProjectReadAccess: vi.fn() }));
vi.mock("@/lib/affaires/google-drive/content", () => ({ readLinkedDriveDocument: vi.fn() }));

import { readAffaireDocumentPreview } from "@/lib/affaires/intake-document-preview";
import { requireAffaireProjectReadAccess } from "@/lib/affaires/intake-server";

const AFFAIRE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCUMENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PDF = new TextEncoder().encode("%PDF-1.7 fictif");

/** A dossier piece stored with `mimeType`, readable by the member. */
function storedPiece(fileName: string, mimeType: string | null) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is"]) query[method] = () => query;
  query.maybeSingle = async () => ({
    data: { tenant_id: "tenant-1", file_name: fileName, mime_type: mimeType, size_bytes: PDF.byteLength, storage_path: "tenant-1/piece", drive_connection_id: null, drive_file_id: null },
    error: null,
  });
  const download = vi.fn(async () => ({ data: new Blob([PDF]), error: null }));
  vi.mocked(requireAffaireProjectReadAccess).mockResolvedValue({
    context: { supabase: { from: () => query, storage: { from: () => ({ download }) } }, tenantId: "tenant-1" },
    project: { id: AFFAIRE },
  } as never);
  return { download };
}

describe("the dossier's document preview", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // The assistant reads such a PDF from its name and cites its pages: the citation's link must open it.
  it.each([null, "application/octet-stream", "application/octet-stream; charset=binary"])("opens a PDF stored with the type %s, from its name", async (mimeType) => {
    storedPiece("CCTP lot plomberie.PDF", mimeType);
    const preview = await readAffaireDocumentPreview(AFFAIRE, DOCUMENT, false);
    expect(preview.mimeType).toBe("application/pdf");
    expect(preview.bytes).toEqual(PDF);
  });

  it("keeps refusing inline a piece whose name gives no previewable format, before reading it", async () => {
    const { download } = storedPiece("Plan RDC.dwg", "application/octet-stream");
    await expect(readAffaireDocumentPreview(AFFAIRE, DOCUMENT, false)).rejects.toThrow("L’aperçu de ce format n’est pas disponible");
    expect(download).not.toHaveBeenCalled();
  });

  it("keeps the stored type when there is one, whatever the name says", async () => {
    storedPiece("notes.pdf", "text/plain");
    expect((await readAffaireDocumentPreview(AFFAIRE, DOCUMENT, false)).mimeType).toBe("text/plain");
  });
});
