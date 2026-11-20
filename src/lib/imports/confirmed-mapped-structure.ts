import { createHash } from "node:crypto";

import { asRecord } from "@/lib/value-guards";
import { classifyMappedRows, MAPPED_ROW_STRUCTURE_KEY, type MappedRowClassification } from "./mapped-row-structure";
import type { ImportStructureDecision } from "./structure";

export const CONFIRMED_MAPPED_STRUCTURE_KEY = "_timax_confirmed_structure";

type MappedIdentity = { id: string; rawRowId?: string | null };
type ConfirmationRow = MappedIdentity & { payload: unknown };

function byMappedId<T extends MappedIdentity>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function rowsDigest(rows: readonly MappedIdentity[]) {
  return createHash("sha256").update(JSON.stringify(rows.map(({ id, rawRowId }) => [id, rawRowId]))).digest("hex");
}

function classificationOf(value: unknown): MappedRowClassification | null {
  const classification = asRecord(value);
  switch (classification?.kind) {
    case "section": return classification.level === 1 || classification.level === 2
      ? { kind: "section", level: classification.level } : null;
    case "line": case "ignore": case "footer": case "parameters": case "ambiguous": case "empty": case "header":
      return { kind: classification.kind };
    default: return null;
  }
}

export function confirmMappedStructure(
  rows: readonly ConfirmationRow[],
  mappingId: string,
  columns: Record<string, unknown>,
  decisions: ImportStructureDecision[],
) {
  if (!rows.length || new Set(rows.map(({ rawRowId }) => rawRowId)).size !== rows.length) return null;
  const structureRows = rows.flatMap((row, index) => {
    const payload = asRecord(row.payload);
    const generation = asRecord(payload?.[MAPPED_ROW_STRUCTURE_KEY])?.mapping_id;
    if (!row.rawRowId || !payload || (generation != null && generation !== mappingId)) return [];
    return [{
      id: row.id,
      rowIndex: Number.isInteger(payload.row_index) ? Number(payload.row_index) : index + 1,
      rawRow: asRecord(payload.raw_row) ?? {},
      mappedRow: asRecord(payload.mapped_row) ?? payload,
    }];
  });
  if (structureRows.length !== rows.length) return null;

  const classified = classifyMappedRows(structureRows, decisions, columns);
  const ordered = byMappedId(rows);
  const anchor = ordered[0];
  if (!anchor.rawRowId) return null;
  return {
    anchor: { ...anchor, rawRowId: anchor.rawRowId },
    receipt: {
      version: 1,
      mapping_id: mappingId,
      rows_digest: rowsDigest(ordered),
      classifications: ordered.map(({ id }) => classified.get(id)!),
    },
  };
}

export function readConfirmedMappedStructure(
  rows: readonly (MappedIdentity & { receipt: unknown })[],
  mappingId: string,
): Map<string, MappedRowClassification> | null {
  const ordered = byMappedId(rows);
  const receipt = asRecord(ordered[0]?.receipt);
  if (receipt?.version !== 1 || receipt.mapping_id !== mappingId || receipt.rows_digest !== rowsDigest(ordered) ||
    !Array.isArray(receipt.classifications) || receipt.classifications.length !== ordered.length) return null;

  const result = new Map<string, MappedRowClassification>();
  for (const [index, row] of ordered.entries()) {
    const classification = classificationOf(receipt.classifications[index]);
    if (!classification || result.has(row.id)) return null;
    result.set(row.id, classification);
  }
  return result;
}
