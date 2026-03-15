export type EstimateStructureMode =
  | "not_started"
  | "imported"
  | "manual"
  | "hybrid"
  | "needs_update";

export type EstimateStructureModeSummary = {
  mode: EstimateStructureMode;
  lineCount: number;
  importedLineCount: number;
  manualLineCount: number;
  unsupportedLineCount: number;
  hasImportableLinkedDpgfSource: boolean;
  canImportLinkedDpgfIntoCurrentStructure: boolean;
  linkedDpgfMappedRowCount: number;
};

type EstimateStructureModeCarrier = {
  item_type?: "section" | "line" | null;
  source_provider?: string | null;
};

type LinkedDpgfSourceCarrier = {
  importStatus?: string | null;
  mappedRowCount?: number | null;
} | null;

function normalizeProvider(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function isImportedStructureProvider(provider: string | null) {
  return provider === "dpgf";
}

function isManualStructureProvider(provider: string | null) {
  return (
    provider === null ||
    provider === "manual" ||
    provider === "ai_structure" ||
    provider === "version_zero_draft" ||
    provider === "generated_ouvrage"
  );
}

function hasImportableLinkedDpgfSource(source: LinkedDpgfSourceCarrier) {
  return Boolean(
    source &&
      source.importStatus === "completed" &&
      typeof source.mappedRowCount === "number" &&
      Number.isFinite(source.mappedRowCount) &&
      source.mappedRowCount > 0
  );
}

export function resolveEstimateStructureModeSummary(input: {
  items: ReadonlyArray<EstimateStructureModeCarrier>;
  linkedDpgfSource?: LinkedDpgfSourceCarrier;
}): EstimateStructureModeSummary {
  let importedLineCount = 0;
  let manualLineCount = 0;
  let unsupportedLineCount = 0;
  let hasImportedStructure = false;
  let hasManualStructure = false;
  let hasUnsupportedStructure = false;

  input.items.forEach((item) => {
    const provider = normalizeProvider(item.source_provider);
    if (isImportedStructureProvider(provider)) {
      hasImportedStructure = true;
      if (item.item_type !== "section") {
        importedLineCount += 1;
      }
      return;
    }

    if (isManualStructureProvider(provider)) {
      hasManualStructure = true;
      if (item.item_type !== "section") {
        manualLineCount += 1;
      }
      return;
    }

    hasUnsupportedStructure = true;
    if (item.item_type !== "section") {
      unsupportedLineCount += 1;
    }
  });

  const lineCount = importedLineCount + manualLineCount + unsupportedLineCount;
  const hasImportableSource = hasImportableLinkedDpgfSource(input.linkedDpgfSource ?? null);
  const linkedDpgfMappedRowCount =
    typeof input.linkedDpgfSource?.mappedRowCount === "number" &&
    Number.isFinite(input.linkedDpgfSource.mappedRowCount)
      ? Math.max(0, Math.trunc(input.linkedDpgfSource.mappedRowCount))
      : 0;

  const mode: EstimateStructureMode =
    !hasImportedStructure && !hasManualStructure && !hasUnsupportedStructure
      ? "not_started"
      : hasUnsupportedStructure
        ? "needs_update"
        : hasImportedStructure && hasManualStructure
          ? "hybrid"
          : hasImportedStructure
            ? "imported"
            : hasManualStructure
              ? "manual"
              : "needs_update";

  return {
    mode,
    lineCount,
    importedLineCount,
    manualLineCount,
    unsupportedLineCount,
    hasImportableLinkedDpgfSource: hasImportableSource,
    canImportLinkedDpgfIntoCurrentStructure:
      mode === "manual" && hasManualStructure && hasImportableSource,
    linkedDpgfMappedRowCount,
  };
}
