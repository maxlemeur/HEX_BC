import { describe, expect, it } from "vitest";

import { mergeGeneratedAffaireBriefWithFallback } from "@/lib/affaires/intake-brief-generation";

const DOC_ALPHA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DOC_BETA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("affaire intake server brief regressions", () => {
  it.each([
    { label: "absent", sourceDocumentIds: [] },
    { label: "invented", sourceDocumentIds: [DOC_BETA] },
  ])("does not substitute fallback sources for $label model attribution", ({ sourceDocumentIds }) => {
    const fallback = {
      summary: { text: "Synthese de repli", sourceDocumentIds: [DOC_ALPHA] },
      projectObject: { text: "Objet de repli", sourceDocumentIds: [DOC_ALPHA] },
      scope: [{ text: "Perimetre de repli", sourceDocumentIds: [DOC_ALPHA] }],
      lots: [], receivedPieces: [], assumptions: [], vigilancePoints: [], missingElements: [],
    };
    const result = mergeGeneratedAffaireBriefWithFallback({
      generated: {
        ...fallback,
        summary: { text: "Affirmation sans preuve", sourceDocumentIds },
        scope: [{ text: "Calorifuge a verifier", sourceDocumentIds }],
      },
      fallback,
      documents: [{
        id: DOC_ALPHA, file_name: "alpha.pdf", document_kind: "cctp", confidence: 0.9, issues: [],
        extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
      }],
    });

    expect(result.summary).toEqual({ text: "Affirmation sans preuve", sourceDocumentIds: [] });
    expect(result.scope).toEqual([{ text: "Calorifuge a verifier", sourceDocumentIds: [] }]);
    expect(result.projectObject.sourceDocumentIds).toEqual([DOC_ALPHA]);
  });

  it("retains only known unique document associations without certifying their content", () => {
    const fallback = {
      summary: { text: "Synthese", sourceDocumentIds: [DOC_ALPHA] },
      projectObject: { text: "Objet", sourceDocumentIds: [DOC_ALPHA] },
      scope: [], lots: [], receivedPieces: [], assumptions: [], vigilancePoints: [], missingElements: [],
    };
    const result = mergeGeneratedAffaireBriefWithFallback({
      generated: { ...fallback, summary: { text: "Association a verifier", sourceDocumentIds: [DOC_BETA, DOC_ALPHA, DOC_ALPHA] } },
      fallback,
      documents: [{
        id: DOC_ALPHA, file_name: "alpha.pdf", document_kind: "cctp", confidence: 0.9, issues: [],
        extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
      }],
    });
    expect(result.summary).toEqual({ text: "Association a verifier", sourceDocumentIds: [DOC_ALPHA] });
  });

  it("filters fallback associations against the same inventory when model text is absent", () => {
    const fallback = {
      summary: { text: "Synthese conservee", sourceDocumentIds: [DOC_BETA] },
      projectObject: { text: "Objet conserve", sourceDocumentIds: [DOC_ALPHA] },
      scope: [{ text: "Perimetre conserve", sourceDocumentIds: [DOC_BETA] }],
      lots: [], receivedPieces: [], assumptions: [], vigilancePoints: [], missingElements: [],
    };
    const result = mergeGeneratedAffaireBriefWithFallback({
      generated: null,
      fallback,
      documents: [{
        id: DOC_ALPHA, file_name: "alpha.pdf", document_kind: "cctp", confidence: 0.9, issues: [],
        extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
      }],
    });
    expect(result.summary).toEqual({ text: "Synthese conservee", sourceDocumentIds: [] });
    expect(result.scope).toEqual([{ text: "Perimetre conserve", sourceDocumentIds: [] }]);
    expect(result.projectObject.sourceDocumentIds).toEqual([DOC_ALPHA]);
  });

  it("preserves trailing fallback rows when the model returns fewer brief entries", () => {
    const result = mergeGeneratedAffaireBriefWithFallback({
      generated: {
        summary: {
          text: "Synthese AI",
          sourceDocumentIds: [DOC_ALPHA],
        },
        projectObject: {
          text: "Objet AI",
          sourceDocumentIds: [DOC_ALPHA],
        },
        scope: [
          {
            text: "Lot Alpha AI",
            sourceDocumentIds: [DOC_ALPHA],
          },
        ],
        lots: [],
        receivedPieces: [],
        assumptions: [],
        vigilancePoints: [],
        missingElements: [],
      },
      fallback: {
        summary: {
          text: "Synthese fallback",
          sourceDocumentIds: [DOC_ALPHA],
        },
        projectObject: {
          text: "Objet fallback",
          sourceDocumentIds: [DOC_ALPHA],
        },
        scope: [
          {
            text: "Lot Alpha fallback",
            sourceDocumentIds: [DOC_ALPHA],
          },
          {
            text: "Lot Beta fallback",
            sourceDocumentIds: [DOC_BETA],
          },
        ],
        lots: [],
        receivedPieces: [],
        assumptions: [],
        vigilancePoints: [],
        missingElements: [],
      },
      documents: [
        {
          id: DOC_ALPHA,
          file_name: "alpha.pdf",
          document_kind: "plans",
          confidence: 0.9,
          issues: [],
          extracted_metadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: [],
            detectedVariants: [],
          },
        },
        {
          id: DOC_BETA,
          file_name: "beta.pdf",
          document_kind: "cctp",
          confidence: 0.8,
          issues: [],
          extracted_metadata: {
            projectName: null,
            clientName: null,
            deadlineAt: null,
            detectedLots: [],
            detectedVariants: [],
          },
        },
      ],
    });

    expect(result.scope).toEqual([
      {
        text: "Lot Alpha AI",
        sourceDocumentIds: [DOC_ALPHA],
      },
      {
        text: "Lot Beta fallback",
        sourceDocumentIds: [DOC_BETA],
      },
    ]);
  });
});
