import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/browser-download", () => ({ downloadBlob: vi.fn() }));

import { downloadBlob } from "@/lib/browser-download";
import { downloadEstimatePdf } from "@/lib/estimates/client";

// A ready job is not a delivered PDF. Keep transport/HTML failures separate from
// success; the real browser journey separately asserts a received PDF download.
describe("PDF download receipt", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("rejects an HTML login response instead of saving it with a PDF extension", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><title>Connexion</title>")));
    await expect(downloadEstimatePdf("owned-version")).rejects.toThrow("Le fichier reçu n'est pas un PDF valide.");
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
