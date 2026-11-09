import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn() }));

import { callStructuredAi } from "@/lib/ai/structured-ai";
import { __securityTesting__ } from "@/lib/affaires/intake-server";
import { createEmptyAffaireIntakeExtractedMetadata } from "@/lib/affaires/intake";

const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const project = { id: uuid, tenant_id: uuid, user_id: uuid, name: "Projet fictif", reference: null, client_name: null, is_archived: false };
const cad = { id: uuid, file_name: "private-model.rvt", document_kind: "plans" as const, confidence: 0.64,
  issues: ["Original uniquement"], extracted_metadata: createEmptyAffaireIntakeExtractedMetadata() };

beforeEach(() => { vi.mocked(callStructuredAi).mockReset().mockRejectedValue(new Error("Owned provider unavailable")); });

describe("CAD/BIM has no AI analysis side effect", () => {
  it("does not call a provider for classification or a CAD-only brief", async () => {
    await __securityTesting__.classifyAffaireIntakeDocument({ fileName: cad.file_name, mimeType: "application/octet-stream", bytes: new ArrayBuffer(10) });
    const brief = await __securityTesting__.generateAffaireBriefDraft({ project, uploadId: uuid, documents: [cad], missingPieces: [] });
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(brief.receivedPieces.join(" ")).toContain(cad.file_name);
  });

  it("keeps the CAD original in the local inventory while excluding it from a mixed AI prompt", async () => {
    const document = { ...cad, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", file_name: "cctp.txt", document_kind: "cctp" as const };
    const brief = await __securityTesting__.generateAffaireBriefDraft({ project, uploadId: uuid, documents: [cad, document], missingPieces: [] });
    expect(callStructuredAi).toHaveBeenCalledOnce();
    const prompt = vi.mocked(callStructuredAi).mock.calls[0][0].prompt;
    expect(prompt).toContain(document.file_name);
    expect(prompt).not.toContain(cad.file_name);
    expect(brief.receivedPieces.join(" ")).toContain(cad.file_name);
  });
});
