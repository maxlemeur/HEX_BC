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

describe("deleteAffaireIntakeDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the register, synced plans and brief after removing an uploaded piece", async () => {
    deleteIntakeDocumentCopyMock.mockResolvedValue({ documentId: DOCUMENT_ID, uploadId: "upload-1", deleted: true, removedUploadedPiece: true });

    await deleteAffaireIntakeDocument({ projectId: PROJECT_ID, documentId: DOCUMENT_ID });

    expect(refreshAffaireIntakeFromActiveDocumentsMock).toHaveBeenCalledExactlyOnceWith({
      supabase: "owner-client", project: { id: PROJECT_ID }, uploadId: "upload-1", actorUserId: "user-1",
    });
  });

  it("leaves the brief and register alone for a rejected piece or a replayed deletion", async () => {
    deleteIntakeDocumentCopyMock.mockResolvedValue({ documentId: DOCUMENT_ID, uploadId: "upload-1", deleted: true, removedUploadedPiece: false });

    await deleteAffaireIntakeDocument({ projectId: PROJECT_ID, documentId: DOCUMENT_ID });

    expect(syncAffaireIntakeDocumentPrioritiesMock).toHaveBeenCalledOnce();
    expect(refreshAffaireIntakeFromActiveDocumentsMock).not.toHaveBeenCalled();
  });
});
