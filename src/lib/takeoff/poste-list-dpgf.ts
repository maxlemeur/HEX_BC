import type { ImportRowStructure } from "@/lib/imports/payload";
import { resolveImportRowTitle } from "@/lib/imports/structure";
import { parseQuantity } from "@/lib/numeric-input/parsers";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import { digestPosteFacts, type DpgfPosteOrigin, type PosteDraft, type PosteSection } from "./poste-list";
import { createDpgfPosteClassifier, isEmptyDpgfCell } from "./poste-list-dpgf-structure";

export type RawDpgfPosteRow = Pick<DpgfPosteOrigin,
  "rowIndex" | "sheetName" | "sourceRowNumber" | "sourcePage" | "tableIndex" | "documentId"
> & { id: string; structure?: ImportRowStructure | null };

export type MappedDpgfPosteRow = {
  id: string;
  rawRowId: string | null;
  designation?: unknown;
  reference?: unknown;
  hex_code?: unknown;
  unit?: unknown;
  quantity?: unknown;
  notes?: unknown;
};

type RowIssue = {
  rawRowId: string | null;
  mappedRowId: string | null;
  rowIndex: number | null;
  sheetName?: string | null;
  sourceRowNumber?: number | null;
  sourcePage?: number | null;
  reason: "missing_mapping" | "multiple_mappings" | "unattested_mapping" | "invalid_quantity" |
    "ambiguous" | "section" | "footer" | "empty" | "header" | "unreadable_designation";
  title?: string;
};

function mappedText(value: unknown) {
  return typeof value === "string" ? value.trim() || null
    : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

export function projectDpgfPostes(input: {
  importId: string;
  mappingId: string;
  rawRows: readonly RawDpgfPosteRow[];
  mappedRows: readonly MappedDpgfPosteRow[];
  columnMapping: Readonly<Record<string, unknown>>;
}) {
  const { importId, mappingId } = input;
  const classifyRow = createDpgfPosteClassifier(input.columnMapping);
  const items: (PosteDraft & { origin: DpgfPosteOrigin })[] = [];
  const unattestedMappingIds: string[] = [];
  const rawIds = new Set(input.rawRows.map(({ id }) => id));
  const mappedByRawId = new Map<string, MappedDpgfPosteRow[]>();
  for (const row of input.mappedRows) {
    if (!row.rawRowId || !rawIds.has(row.rawRowId)) {
      unattestedMappingIds.push(row.id);
      continue;
    }
    const alternatives = mappedByRawId.get(row.rawRowId) ?? [];
    alternatives.push(row);
    mappedByRawId.set(row.rawRowId, alternatives);
  }

  const counts = {
    source: input.rawRows.length, useful: 0, ambiguous: 0, missing: 0, omitted: 0,
    orphaned: unattestedMappingIds.length,
  };
  const issues = unattestedMappingIds.sort().map((mappedRowId): RowIssue => ({
    rawRowId: null, mappedRowId, rowIndex: null, reason: "unattested_mapping",
  }));
  let sections: PosteSection[] = [];
  const sorted = [...input.rawRows].sort((a, b) => a.rowIndex - b.rowIndex || a.id.localeCompare(b.id));
  for (const { id: rawRowId, structure, ...source } of sorted) {
    const matches = mappedByRawId.get(rawRowId) ?? [];
    const row = matches.length === 1 ? matches[0] : null;
    const issue = {
      rawRowId, mappedRowId: row?.id ?? null, rowIndex: source.rowIndex,
      sheetName: source.sheetName, sourceRowNumber: source.sourceRowNumber, sourcePage: source.sourcePage,
    };
    if (!row) {
      if (matches.length) {
        counts.ambiguous++;
        issues.push({ ...issue, reason: "multiple_mappings" });
      } else {
        counts.missing++;
        issues.push({ ...issue, reason: "missing_mapping" });
      }
      continue;
    }

    const classification = classifyRow(row, structure);
    const title = resolveImportRowTitle(row);
    if (classification.kind === "ambiguous") {
      counts.ambiguous++;
      issues.push({ ...issue, reason: "ambiguous", title });
      continue;
    }
    if (classification.kind === "section") {
      const section = { id: rawRowId, title, order: source.rowIndex };
      sections = [...sections.slice(0, classification.level - 1), section];
    }
    if (classification.kind !== "line") {
      counts.omitted++;
      issues.push({
        ...issue, reason: classification.kind,
        ...(classification.kind === "section" ? { title } : {}),
      });
      continue;
    }

    const hasQuantity = !isEmptyDpgfCell(row.quantity);
    const parsedQuantity = hasQuantity ? parseQuantity(row.quantity) : null;
    const quantity = parsedQuantity !== null && parsedQuantity >= 0 ? parsedQuantity : null;
    if (hasQuantity && quantity === null) {
      issues.push({ ...issue, reason: "invalid_quantity", title });
    }
    const unit = mappedText(row.unit);
    const reference = mappedText(row.reference) ?? mappedText(row.hex_code);
    const measurementNotes = mappedText(row.notes);
    const expectedUnit = unit ? normalizeMeasurementUnit(unit).unitCode : null;
    counts.useful++;
    items.push({
      label: title,
      expectedUnit,
      referenceQuantity: quantity,
      measurementBasis: null,
      qualifiers: {},
      sections,
      origin: {
        kind: "dpgf", importId, mappingId, rawRowId, mappedRowId: row.id, reference, sourceUnit: unit, measurementNotes, ...source,
        factsDigest: digestPosteFacts([classification, title, reference, unit, row.quantity ?? null, measurementNotes]),
      },
    });
  }
  return { items, issues, counts };
}

export type DpgfPosteProjection = ReturnType<typeof projectDpgfPostes>;
