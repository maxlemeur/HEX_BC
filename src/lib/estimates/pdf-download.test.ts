import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser-download", () => ({ downloadBlob: vi.fn() }));

import { downloadBlob } from "@/lib/browser-download";
import { downloadEstimatePdf } from "@/lib/estimates/client";

// A ready job is not a delivered PDF. Keep transport/HTML failures separate from
// success; the real browser journey separately asserts a received PDF download.
describe("PDF download receipt", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("receives the real PDF binary before triggering the normal file download", async () => {
    const bytes = await readFile("e2e/fixtures/sample-plan.pdf");
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, {
      headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="devis-test.pdf"' },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await downloadEstimatePdf("owned-version");
    expect(fetchMock).toHaveBeenCalledWith("/api/estimates/owned-version/pdf", { credentials: "same-origin" });
    expect(downloadBlob).toHaveBeenCalledOnce();
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(bytes);
    expect(filename).toBe("devis-test.pdf");
  });

  it("does not announce or download a failed ready-file transfer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: "PDF_GENERATION_FAILED", message: "PDF indisponible" },
    }), { status: 500, headers: { "content-type": "application/json" } })));
    await expect(downloadEstimatePdf("owned-version")).rejects.toThrow("PDF indisponible");
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("rejects an HTML login response instead of saving it with a PDF extension", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><title>Connexion</title>")));
    await expect(downloadEstimatePdf("owned-version")).rejects.toThrow("Le fichier reçu n'est pas un PDF valide.");
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
