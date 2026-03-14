import { describe, expect, it } from "vitest";

import {
  resolveEstimateStructureModeSummary,
  type EstimateStructureModeSummary,
} from "@/lib/estimates/structure-mode";

function resolve(
  overrides: Parameters<typeof resolveEstimateStructureModeSummary>[0],
): EstimateStructureModeSummary {
  return resolveEstimateStructureModeSummary(overrides);
}

describe("resolveEstimateStructureModeSummary", () => {
  it("returns not_started for an empty version", () => {
    expect(resolve({ items: [] })).toEqual({
      mode: "not_started",
      lineCount: 0,
      importedLineCount: 0,
      manualLineCount: 0,
      unsupportedLineCount: 0,
      hasImportableLinkedDpgfSource: false,
      canImportLinkedDpgfIntoCurrentStructure: false,
      linkedDpgfMappedRowCount: 0,
    });
  });

  it("returns imported when only DPGF lines exist", () => {
    const result = resolve({
      items: [
        { item_type: "line", source_provider: "dpgf" },
        { item_type: "line", source_provider: "dpgf" },
      ],
    });

    expect(result).toMatchObject({
      mode: "imported",
      lineCount: 2,
      importedLineCount: 2,
      manualLineCount: 0,
      unsupportedLineCount: 0,
    });
  });

  it("returns manual and keeps the hybrid continuation explicit when a linked DPGF is importable", () => {
    const result = resolve({
      items: [
        { item_type: "line", source_provider: "manual" },
        { item_type: "line", source_provider: "ai_structure" },
      ],
      linkedDpgfSource: {
        importStatus: "completed",
        mappedRowCount: 14,
      },
    });

    expect(result).toMatchObject({
      mode: "manual",
      lineCount: 2,
      importedLineCount: 0,
      manualLineCount: 2,
      unsupportedLineCount: 0,
      hasImportableLinkedDpgfSource: true,
      canImportLinkedDpgfIntoCurrentStructure: true,
      linkedDpgfMappedRowCount: 14,
    });
  });

  it("returns hybrid when imported and manual lines already coexist", () => {
    const result = resolve({
      items: [
        { item_type: "line", source_provider: "dpgf" },
        { item_type: "line", source_provider: "manual" },
        { item_type: "line", source_provider: "version_zero_draft" },
      ],
    });

    expect(result).toMatchObject({
      mode: "hybrid",
      lineCount: 3,
      importedLineCount: 1,
      manualLineCount: 2,
      unsupportedLineCount: 0,
      canImportLinkedDpgfIntoCurrentStructure: false,
    });
  });

  it("returns needs_update when unsupported structural provenance is mixed in", () => {
    const result = resolve({
      items: [
        { item_type: "line", source_provider: "manual" },
        { item_type: "line", source_provider: "takeoff" },
      ],
      linkedDpgfSource: {
        importStatus: "completed",
        mappedRowCount: 7,
      },
    });

    expect(result).toMatchObject({
      mode: "needs_update",
      lineCount: 2,
      importedLineCount: 0,
      manualLineCount: 1,
      unsupportedLineCount: 1,
      hasImportableLinkedDpgfSource: true,
      canImportLinkedDpgfIntoCurrentStructure: false,
    });
  });
});
