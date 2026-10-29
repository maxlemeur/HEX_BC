import { afterEach, describe, expect, it, vi } from "vitest";

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
