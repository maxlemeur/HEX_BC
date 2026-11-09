import { afterEach, describe, expect, it, vi } from "vitest";

import { addFileToDossier } from "@/lib/affaires/intake-upload-client";

const file = () => new File([new Uint8Array([37, 80, 68, 70])], "Réseaux (tracé 1-50).pdf", { type: "application/pdf" });

function installFetch(answer: () => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url; void init;
    return answer();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const accepted = { documentId: "doc-1", fileName: "Réseaux (tracé 1-50).pdf", status: "uploaded", rejectionReason: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("addFileToDossier", () => {
  it("posts the file where the dossier receives its documents", async () => {
    const fetchMock = installFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { uploadId: "u-1", files: [accepted] } }) }));
    const sent = file();
    await expect(addFileToDossier("affaire-1", sent)).resolves.toEqual({ ok: true, documentId: "doc-1", fileName: "Réseaux (tracé 1-50).pdf" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/affaires/affaire-1/intake/files");
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).getAll("files")).toEqual([sent]);
  });

  it("reads an answer that is not wrapped", async () => {
    installFetch(() => ({ ok: true, status: 200, json: async () => ({ uploadId: "u-1", files: [accepted] }) }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toMatchObject({ ok: true, documentId: "doc-1" });
  });

  it("says why the dossier turned the file down", async () => {
    installFetch(() => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, data: { uploadId: "u-1", files: [{ ...accepted, status: "rejected", rejectionReason: "Fichier trop volumineux." }] } }),
    }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toEqual({ ok: false, message: "Fichier trop volumineux." });
  });

  it("has a sentence when the dossier turns the file down without a reason", async () => {
    installFetch(() => ({ ok: true, status: 200, json: async () => ({ uploadId: "u-1", files: [{ ...accepted, status: "rejected" }] }) }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toEqual({ ok: false, message: "Le dossier a refusé ce fichier." });
  });

  it.each([
    [{ error: "Accès refusé." }, "Accès refusé."],
    [{ ok: false, error: { code: "forbidden", message: "Vous ne pouvez pas modifier cette affaire." } }, "Vous ne pouvez pas modifier cette affaire."],
    [null, "Erreur serveur (403)"],
  ])("repeats what the server says when it refuses", async (payload, message) => {
    installFetch(() => ({ ok: false, status: 403, json: async () => payload }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toEqual({ ok: false, message });
  });

  it("does not take an answer it cannot read for a success", async () => {
    installFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { files: [] } }) }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toEqual({ ok: false, message: "Réponse upload invalide." });
    installFetch(() => ({ ok: true, status: 200, json: async () => ({ uploadId: "u-1", files: [] }) }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toEqual({ ok: false, message: "Réponse upload invalide." });
    installFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toEqual({ ok: false, message: "Réponse upload invalide." });
  });

  it("reports a network that fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(addFileToDossier("affaire-1", file())).resolves.toEqual({ ok: false, message: "Erreur réseau. Vérifiez votre connexion." });
  });
});
