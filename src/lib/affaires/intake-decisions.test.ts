import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/decisions", () => ({ getOpenAiDecisionsCapability: vi.fn(), callOpenAiDecisions: vi.fn() }));
import { callOpenAiDecisions, getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { proposeAffaireIntakeCategory } from "@/lib/affaires/intake-decisions";
import { createEmptyAffaireIntakeExtractedMetadata, deriveAffaireIntakeClassificationStatus } from "@/lib/affaires/intake";

const extracted = { documentKind: "annexes" as const, confidence: 0.9, issues: ["Indice illisible"],
  extractedMetadata: { ...createEmptyAffaireIntakeExtractedMetadata(), projectName: "Dossier témoin", detectedLots: ["Plomberie"] } };
const input = { owner: { tenantId: "tenant-a", userId: "owner" }, projectId: "project-a", documentId: "doc-a", sourceVersion: "sha-a",
  fileName: "piece.pdf", mimeType: "application/pdf", extracted };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOpenAiDecisionsCapability).mockReturnValue({ status: "available" } as never);
});

it("preserves metadata and extraction problems while a category proposal requires human review", async () => {
  vi.mocked(callOpenAiDecisions).mockResolvedValue({ status: "available", answers: [{ name: "document_category", status: "answered", value: "plans" }],
    provenance: { model: "gpt-6-luna", request_fingerprint: "request-sha" } } as never);
  const result = await proposeAffaireIntakeCategory(input);
  expect(result.documentKind).toBe("plans");
  expect(result.extractedMetadata).toEqual(extracted.extractedMetadata);
  expect(result.issues).toContain("Indice illisible");
  expect(deriveAffaireIntakeClassificationStatus(result)).toBe("ambiguous");
});

it("keeps a refused category unresolved without inventing a replacement", async () => {
  vi.mocked(callOpenAiDecisions).mockResolvedValue({ status: "partial", answers: [{ name: "document_category", status: "refused", value: null }],
    provenance: { model: "gpt-6-luna", request_fingerprint: "request-sha" } } as never);
  const result = await proposeAffaireIntakeCategory(input);
  expect(result.documentKind).toBe("a_classer");
  expect(result.extractedMetadata).toEqual(extracted.extractedMetadata);
});
