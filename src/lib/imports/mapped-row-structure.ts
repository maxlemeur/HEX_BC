import { isWorkbookParameterRow } from "@/lib/imports/optima-profile";
import {
  EMPTY_CELL_SENTINELS,
  isImportFooterTitle,
  resolveImportRowTitle,
  resolveImportStructure,
  type ImportStructureDecision,
  type ImportStructureLevel,
  type ImportStructureRow,
} from "@/lib/imports/structure";

export const MAPPED_ROW_STRUCTURE_KEY = "_timax_mapped_structure";

export type MappedRowClassification =
  | { kind: "section"; level: ImportStructureLevel }
  | { kind: "line" | "ignore" | "footer" | "parameters" | "ambiguous" | "empty" | "header" };

export function isEmptyMappedCell(value: unknown) {
  return value == null || (typeof value === "string" && EMPTY_CELL_SENTINELS.has(value.trim().toLowerCase()));
}

/** Record the import's structural decisions at mapping time, before any price or labour validation. */
export function classifyMappedRows(
  rows: ImportStructureRow[],
  decisions: ImportStructureDecision[],
  columnMapping: Record<string, unknown>,
): Map<string, MappedRowClassification> {
  const structure = resolveImportStructure(rows, decisions);
  const candidates = new Set(structure.preview.candidates.map(({ row_index }) => row_index));
  const explicit = new Set(decisions.map(({ rowIndex }) => rowIndex));
  const sourceByTarget = new Map(Object.entries(columnMapping).map(([source, target]) => [target, source]));

  return new Map(rows.map((row) => {
    const decision = structure.decisionsByRowIndex.get(row.rowIndex);
    const title = resolveImportRowTitle(row.mappedRow);
    const { designation, unit, quantity, reference, hex_code } = row.mappedRow;
    const footerInReference = isEmptyMappedCell(unit) && isEmptyMappedCell(quantity) &&
      isImportFooterTitle(String(reference ?? hex_code ?? ""));
    let classification: MappedRowClassification;
    // A sparse PDF total can put its title in the reference cell and its amount
    // in the designation cell. The import UI may default this candidate to a line.
    if (structure.footerRowIndexes.has(row.rowIndex) || footerInReference) classification = { kind: "footer" };
    else if (decision?.kind === "ignore") classification = { kind: "ignore" };
    else if (isWorkbookParameterRow(row.mappedRow, title)) classification = { kind: "parameters" };
    else if (decision?.kind === "section") classification = { kind: "section", level: decision.level };
    else if (
      typeof designation === "string" && designation.trim() === sourceByTarget.get("designation") &&
      ((typeof unit === "string" && unit.trim() === sourceByTarget.get("unit")) ||
        (typeof quantity === "string" && quantity.trim() === sourceByTarget.get("quantity"))) &&
      !explicit.has(row.rowIndex)
    ) classification = { kind: "header" };
    else if (!title) classification = { kind: "empty" };
    else if (
      candidates.has(row.rowIndex) && !explicit.has(row.rowIndex) &&
      isEmptyMappedCell(quantity) && isEmptyMappedCell(unit)
    ) classification = { kind: "ambiguous" };
    else classification = { kind: "line" };
    return [row.id, classification];
  }));
}
