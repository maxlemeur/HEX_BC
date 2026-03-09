import { describe, expect, it } from "vitest";

import {
  classifyTakeoffPlanSetSource,
  classifyTakeoffUploadSource,
  getTakeoffSelectionWarning,
  isTakeoffLevelCompatible,
} from "@/lib/takeoff/document-classifier";

describe("classifyTakeoffUploadSource", () => {
  it("classifies spreadsheets as structured level A", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "metrage-cvc.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 2_048,
    });

    expect(recommendation).toMatchObject({
      documentClass: "structured",
      recommendedLevel: "A",
      compatibleLevels: ["A"],
      recommendationStrength: "high",
      warningCode: null,
    });
  });

  it("classifies table-like PDFs as level B", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "lot-cvc-dpgf.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_000,
    });

    expect(recommendation).toMatchObject({
      documentClass: "tabular_pdf",
      recommendedLevel: "B",
      compatibleLevels: ["B", "C"],
      recommendationStrength: "high",
    });
  });

  it("classifies plan-like PDFs as level C", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "plan-rdc-electricite.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_000,
    });

    expect(recommendation).toMatchObject({
      documentClass: "complex_plan",
      recommendedLevel: "C",
      compatibleLevels: ["B", "C"],
      recommendationStrength: "high",
    });
  });

  it("falls back to low-confidence level B for ambiguous PDFs", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "scan-001.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_000,
    });

    expect(recommendation).toMatchObject({
      documentClass: "tabular_pdf",
      recommendedLevel: "B",
      recommendationStrength: "low",
      warningCode: "ambiguous_pdf",
    });
  });

  it("classifies unsupported uploads without recommendation", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "note.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 3_000,
    });

    expect(recommendation).toMatchObject({
      documentClass: "unsupported",
      recommendedLevel: null,
      compatibleLevels: ["B", "C"],
      warningCode: "unsupported_override",
    });
  });
});

describe("classifyTakeoffPlanSetSource", () => {
  it("classifies multi-file plan sets as complex plan", () => {
    const recommendation = classifyTakeoffPlanSetSource({
      files: [
        {
          file_name: "plan-rdc.pdf",
          file_type: "application/pdf",
          page_count: 2,
        },
        {
          file_name: "plan-etage.pdf",
          file_type: "application/pdf",
          page_count: 3,
        },
      ],
    });

    expect(recommendation).toMatchObject({
      documentClass: "complex_plan",
      recommendedLevel: "C",
      compatibleLevels: ["B", "C"],
      recommendationStrength: "high",
    });
  });

  it("marks empty plan sets as unsupported", () => {
    const recommendation = classifyTakeoffPlanSetSource({
      files: [],
    });

    expect(recommendation).toMatchObject({
      documentClass: "unsupported",
      recommendedLevel: null,
      warningCode: "unsupported_override",
    });
  });
});

describe("takeoff recommendation helpers", () => {
  it("detects compatible levels", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "scan-001.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_000,
    });

    expect(isTakeoffLevelCompatible(recommendation, "B")).toBe(true);
    expect(isTakeoffLevelCompatible(recommendation, "C")).toBe(true);
    expect(isTakeoffLevelCompatible(recommendation, "A")).toBe(false);
  });

  it("returns a critical warning on strong mismatch", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "plan-rdc-electricite.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_000,
    });

    expect(
      getTakeoffSelectionWarning({
        recommendation,
        selectedLevel: "B",
      })
    ).toMatchObject({
      code: "strong_mismatch",
      severity: "critical",
    });
  });

  it("returns a cost warning when escalating above recommendation", () => {
    const recommendation = classifyTakeoffUploadSource({
      fileName: "lot-cvc-dpgf.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3_000,
    });

    expect(
      getTakeoffSelectionWarning({
        recommendation,
        selectedLevel: "C",
      })
    ).toMatchObject({
      code: "cost_warning",
      severity: "warning",
    });
  });
});
