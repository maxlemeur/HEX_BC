import { describe, expect, it } from "vitest";

import {
  hasMissingEvidenceSourceContext,
  resolveEvidenceSourceContext,
} from "@/components/takeoff/evidence-source-context";

describe("evidence source context", () => {
  it("resolves an openable page, zone and provenance from available metadata", () => {
    const context = resolveEvidenceSourceContext({
      source_file_name: "plan-cvc.pdf",
      source_page: 8,
      metadata: {
        signed_document_url: "https://files.example.com/plan.pdf?token=abc",
        source_zone: { label: "Niveau R+1 / axe B-C", bbox: [10, 20, 40, 50] },
        sourceDocumentId: "document-42",
        _timax_provenance: {
          provider: "gemini",
          model: "gemini-pro",
        },
        revision: "D",
        revision_status: "active",
      },
    });

    expect(context.documentPageUrl).toBe(
      "https://files.example.com/plan.pdf?token=abc#page=8"
    );
    expect(context.previewUrl).toBe(context.documentPageUrl);
    expect(context.zoneLabel).toBe("Niveau R+1 / axe B-C");
    expect(context.hasZoneCoordinates).toBe(true);
    expect(context.sourceDocumentId).toBe("document-42");
    expect(context.extractionProvider).toBe("gemini");
    expect(context.extractionModel).toBe("gemini-pro");
    expect(context.revision.revision).toBe("D");
  });

  it("rejects unsafe URLs and leaves unavailable provenance empty", () => {
    const context = resolveEvidenceSourceContext({
      source_file_name: null,
      source_page: null,
      metadata: { signed_document_url: "javascript:alert(1)" },
    });

    expect(context.documentUrl).toBeNull();
    expect(context.previewUrl).toBeNull();
    expect(context.sourceDocumentId).toBeNull();
  });

  it("requires a page or zone for PDFs but not for tabular sources", () => {
    expect(
      hasMissingEvidenceSourceContext({
        source_file_name: "plan.pdf",
        source_page: null,
        metadata: {},
      })
    ).toBe(true);

    expect(
      hasMissingEvidenceSourceContext({
        source_file_name: "bordereau.csv",
        source_page: null,
        metadata: {},
      })
    ).toBe(false);

    expect(
      hasMissingEvidenceSourceContext({
        source_file_name: "plan.pdf",
        source_page: null,
        metadata: { zone: "Façade nord" },
      })
    ).toBe(false);
  });
});
