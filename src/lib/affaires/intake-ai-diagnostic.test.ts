import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn() }));

import { callStructuredAi } from "@/lib/ai/structured-ai";
import { __securityTesting__ } from "@/lib/affaires/intake-server";
import { TakeoffError } from "@/lib/takeoff/errors";

describe("affaire brief provider failure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the fallback brief and records no provider content or credentials", async () => {
    const privateMarker = "SYNTHETIC_PRIVATE_DOCUMENT_PROMPT_KEY";
    const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const uploadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const error = new TakeoffError({
      code: "AI_PROVIDER",
      message: privateMarker,
      retryable: false,
      details: { provider_status: 400, provider_details: { error: { message: privateMarker } } },
    });
    vi.mocked(callStructuredAi).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const renewLease = vi.fn().mockResolvedValue(undefined);

    const draft = await __securityTesting__.generateAffaireBriefDraft({
      project: {
        id: projectId,
        tenant_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        name: "Affaire fictive",
        reference: "QA",
        client_name: null,
        is_archived: false,
      },
      uploadId,
      documents: [{
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        file_name: "exemple.xlsx",
        document_kind: "dpgf",
        confidence: 1,
        issues: [],
        extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
      }],
      missingPieces: [],
      renewLease,
    });

    expect(draft.status).toBe("a_confirmer");
    expect(renewLease).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("Affaire brief AI generation failed", expect.objectContaining({
      projectId,
      uploadId,
      error_code: "AI_PROVIDER",
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
    expect(log.mock.calls.flat()).not.toContain(error);
  });
});

describe("affaire document classification failure", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("keeps the heuristic classification without logging the filename or provider error", async () => {
    const privateFile = "SYNTHETIC_PRIVATE_FILENAME";
    const privateDetails = "SYNTHETIC_PRIVATE_PROVIDER_DOCUMENT_PROMPT_KEY";
    const error = new TakeoffError({
      code: "AI_PROVIDER",
      message: privateDetails,
      retryable: false,
      details: { provider_status: 400, provider_details: { error: { message: privateDetails } } },
    });
    vi.mocked(callStructuredAi).mockRejectedValueOnce(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const beforeProviderCall = vi.fn().mockResolvedValue(undefined);

    const classification = await __securityTesting__.classifyAffaireIntakeDocument({
      fileName: `DPGF ${privateFile}.pdf`,
      mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      beforeProviderCall,
    });

    expect(classification.source).toBe("heuristic");
    expect(classification.result.documentKind).toBe("dpgf");
    expect(classification.result.issues).toContain("Classification heuristique retenue car l'analyse IA a echoue.");
    expect(beforeProviderCall).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledExactlyOnceWith("Affaire intake AI classification failed", { error_code: "AI_PROVIDER" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateFile);
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateDetails);
  });

  it("records only a fixed code when an unreadable workbook prevents the provider call", async () => {
    const privateFile = "SYNTHETIC_PRIVATE_FILENAME";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const beforeProviderCall = vi.fn().mockResolvedValue(undefined);

    const classification = await __securityTesting__.classifyAffaireIntakeDocument({
      fileName: `DPGF ${privateFile}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: new Uint8Array([1, 2, 3]).buffer,
      beforeProviderCall,
    });

    expect(classification.source).toBe("heuristic");
    expect(classification.result.documentKind).toBe("dpgf");
    expect(classification.result.issues).toContain("Analyse IA indisponible pour ce format, classement heuristique applique.");
    expect(beforeProviderCall).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith("Failed to build affaire intake classification payload", { error_code: "CLASSIFICATION_PAYLOAD_ERROR" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateFile);
  });

  it("maps unknown provider errors to a fixed code without logging their content", async () => {
    const privateMarker = "SYNTHETIC_PRIVATE_UNKNOWN_PROVIDER_ERROR";
    vi.mocked(callStructuredAi).mockRejectedValueOnce(Object.assign(new Error(privateMarker), { code: privateMarker }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const classification = await __securityTesting__.classifyAffaireIntakeDocument({
      fileName: "DPGF_exemple.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]).buffer,
    });

    expect(classification.source).toBe("heuristic");
    expect(log).toHaveBeenCalledExactlyOnceWith("Affaire intake AI classification failed", { error_code: "PROVIDER_ERROR" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(privateMarker);
  });
});
