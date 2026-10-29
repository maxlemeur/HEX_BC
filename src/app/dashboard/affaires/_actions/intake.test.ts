import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteIntakeDocumentCopyMock = vi.hoisted(() => vi.fn());
const refreshAffaireIntakeFromActiveDocumentsMock = vi.hoisted(() => vi.fn());
const syncAffaireIntakeDocumentPrioritiesMock = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/affaires/intake-document-store", () => ({
  deleteIntakeDocumentCopy: deleteIntakeDocumentCopyMock,
}));

vi.mock("@/lib/affaires/intake-server", () => ({
  refreshAffaireIntakeFromActiveDocuments: refreshAffaireIntakeFromActiveDocumentsMock,
  requireAffaireProjectOwnerOrAdmin: vi.fn(async () => ({
    context: { supabase: "owner-client", userId: "user-1" },
    project: { id: PROJECT_ID },
  })),
  syncAffaireIntakeDocumentPriorities: syncAffaireIntakeDocumentPrioritiesMock,
}));

import { deleteAffaireIntakeDocument } from "@/app/dashboard/affaires/_actions/intake";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";

// The store runs the refresh between the verified removal and the tombstone.
function deletingWith(removed: { uploadId: string; wasUploaded: boolean }) {
  deleteIntakeDocumentCopyMock.mockImplementation(async (_access, documentId, refresh) => {
    await refresh(removed);
    return { documentId, deleted: true };
  });
}

describe("deleteAffaireIntakeDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the register, synced plans and brief after removing an uploaded piece, without waiting on Drive", async () => {
    deletingWith({ uploadId: "upload-1", wasUploaded: true });

    await deleteAffaireIntakeDocument({ projectId: PROJECT_ID, documentId: DOCUMENT_ID });

    expect(syncAffaireIntakeDocumentPrioritiesMock).toHaveBeenCalledExactlyOnceWith({ supabase: "owner-client", projectId: PROJECT_ID });
    expect(refreshAffaireIntakeFromActiveDocumentsMock).toHaveBeenCalledExactlyOnceWith({
      supabase: "owner-client", project: { id: PROJECT_ID }, uploadId: "upload-1", actorUserId: "user-1", readDrive: false,
    });
  });

  it("restores a principal for the released piece's kind when the deletion is interrupted", async () => {
    deleteIntakeDocumentCopyMock.mockRejectedValue(new Error("Fichier retiré du stockage ; actualisation du dossier interrompue. Reprenez la suppression."));

    await expect(deleteAffaireIntakeDocument({ projectId: PROJECT_ID, documentId: DOCUMENT_ID })).rejects.toThrow("Reprenez la suppression");

    expect(syncAffaireIntakeDocumentPrioritiesMock).toHaveBeenCalledExactlyOnceWith({ supabase: "owner-client", projectId: PROJECT_ID });
    expect(refreshAffaireIntakeFromActiveDocumentsMock).not.toHaveBeenCalled();
  });

  it("leaves the brief and register alone after removing a rejected piece", async () => {
    deletingWith({ uploadId: "upload-1", wasUploaded: false });

    await deleteAffaireIntakeDocument({ projectId: PROJECT_ID, documentId: DOCUMENT_ID });

    expect(syncAffaireIntakeDocumentPrioritiesMock).toHaveBeenCalledOnce();
    expect(refreshAffaireIntakeFromActiveDocumentsMock).not.toHaveBeenCalled();
  });
});
