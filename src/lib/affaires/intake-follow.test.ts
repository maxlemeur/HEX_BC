import { describe, expect, it } from "vitest";

import { AFFAIRE_DOSSIER_FOLLOW_CEILING_MS, affaireDossierWaitKey } from "@/lib/affaires/intake-follow";

// What the page waits for is what the server stored: a batch's analysis ends when its run records the upload's last
// status (finish_affaire_intake_upload_attempt), after it wrote the brief; a piece analysed again on its own ends with
// its own classification. Nothing else ends the wait, and the wait is per batch.
const piece = (classificationStatus: "queued" | "processing" | "classified" | "ambiguous" | "failed", documentId = "document-1") => ({
  documentId, fileName: "Plan RDC.pdf", uploadStatus: "uploaded" as const, detectedCategory: "plans" as const,
  classificationStatus, confidence: 0.9, issues: [],
});

describe("affaireDossierWaitKey", () => {
  it("waits while a batch's analysis has not ended, a failed classification included", () => {
    // The brief is built from the uploaded pieces, a failed one included, and may follow as a fallback brief.
    expect(affaireDossierWaitKey({ pendingUploadIds: ["upload-1"], documents: [piece("failed")], briefDraft: null })).not.toBeNull();
    expect(affaireDossierWaitKey({ pendingUploadIds: ["upload-1"], documents: [piece("classified")], briefDraft: { status: "a_confirmer" } }))
      .not.toBeNull();
  });

  it("starts a new wait for a new batch, whatever the previous one did", () => {
    const first = affaireDossierWaitKey({ pendingUploadIds: ["upload-1"], documents: [piece("classified")], briefDraft: null });
    const second = affaireDossierWaitKey({ pendingUploadIds: ["upload-2"], documents: [piece("classified")], briefDraft: { status: "a_confirmer" } });
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("waits for a piece analysed again on its own, which no batch follows", () => {
    expect(affaireDossierWaitKey({ pendingUploadIds: [], documents: [piece("processing")], briefDraft: { status: "a_confirmer" } })).not.toBeNull();
  });

  it("waits for nothing once the server recorded the end of every batch, with or without a brief", () => {
    expect(affaireDossierWaitKey({ pendingUploadIds: [], documents: [piece("classified")], briefDraft: null })).toBeNull();
    expect(affaireDossierWaitKey({ pendingUploadIds: [], documents: [piece("failed")], briefDraft: null })).toBeNull();
    expect(affaireDossierWaitKey(null)).toBeNull();
  });

  it("ends a wait the server never closes after its own limits: a lease and the longest retry backoff", () => {
    expect(AFFAIRE_DOSSIER_FOLLOW_CEILING_MS).toBe(15 * 60 * 1000);
  });
});
