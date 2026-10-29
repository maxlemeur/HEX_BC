import { z } from "zod";

import { unprocessableEntity } from "@/lib/estimates/errors";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { takeoffDpgfCompareEstimateItemRowSchema } from "@/lib/takeoff/estimate-line-read-contract";
import type {
  TakeoffDpgfManualLinkRecord,
  TakeoffDpgfReviewDecisionRecord,
  TakeoffDpgfComparisonDpgfLine,
  TakeoffDpgfComparisonTakeoffLine,
  TakeoffDpgfComparisonResponse,
  TakeoffJobItem,
} from "@/lib/takeoff/types";

export type TakeoffDpgfEstimateItem = z.infer<typeof takeoffDpgfCompareEstimateItemRowSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const takeoffDpgfManualLinkSchema: z.ZodType<TakeoffDpgfManualLinkRecord> = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  version_id: z.string().uuid(),
  takeoff_job_id: z.string().uuid(),
  estimate_item_id: z.string().uuid(),
  takeoff_item_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  linked_by: z.string().uuid().nullable(),
});

const takeoffDpgfReviewDecisionSchema: z.ZodType<TakeoffDpgfReviewDecisionRecord> = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  version_id: z.string().uuid(),
  takeoff_job_id: z.string().uuid(),
  estimate_item_id: z.string().uuid(),
  review_reference: z.string().min(1),
  line_label: z.string(),
  line_position: z.number().int().nonnegative(),
  source_file_name: z.string().nullable(),
  source_page: z.number().int().nullable(),
  decision: z.enum(["keep_dpgf", "keep_takeoff", "manual_fix", "out_of_scope"]),
  reason: z.string().nullable(),
  decided_at: z.string(),
  updated_at: z.string(),
  decided_by: z.string().uuid().nullable(),
  source: z.enum(["current_version", "carried_over"]),
  carried_over_from_version_id: z.string().uuid().nullable(),
  carried_over_from_version_number: z.number().int().positive().nullable(),
});

const takeoffDpgfCompareMappedRowSchema = z.object({
  id: z.string().uuid(),
  payload: z.record(z.string(), z.unknown()),
});

function normalizeTakeoffDpgfManualLinkRow(row: unknown): TakeoffDpgfManualLinkRecord {
  return parseWithSchema(
    takeoffDpgfManualLinkSchema,
    row,
    "Données takeoff_dpgf_links invalides en base."
  );
}

export function normalizeTakeoffDpgfManualLinkRows(rows: unknown[]): TakeoffDpgfManualLinkRecord[] {
  return rows.map((row) => normalizeTakeoffDpgfManualLinkRow(row));
}

function normalizeTakeoffDpgfReviewDecisionRow(
  row: unknown
): TakeoffDpgfReviewDecisionRecord {
  return parseWithSchema(
    takeoffDpgfReviewDecisionSchema,
    row,
    "Données takeoff_dpgf_review_decisions invalides en base."
  );
}

export function buildTakeoffDpgfReviewDecisionRecord(input: {
  row: unknown;
  carriedOverVersionNumberById?: Map<string, number>;
}): TakeoffDpgfReviewDecisionRecord {
  if (!isRecord(input.row)) {
    throw unprocessableEntity(
      "Données takeoff_dpgf_review_decisions invalides en base.",
      {
        row: input.row,
      },
      "VALIDATION_ERROR"
    );
  }

  const carriedOverFromVersionId =
    typeof input.row.carried_over_from_version_id === "string" &&
    input.row.carried_over_from_version_id.trim().length > 0
      ? input.row.carried_over_from_version_id
      : null;

  return normalizeTakeoffDpgfReviewDecisionRow({
    ...input.row,
    source: carriedOverFromVersionId ? "carried_over" : "current_version",
    carried_over_from_version_id: carriedOverFromVersionId,
    carried_over_from_version_number: carriedOverFromVersionId
      ? (input.carriedOverVersionNumberById?.get(carriedOverFromVersionId) ?? null)
      : null,
  });
}

export function buildTakeoffDpgfReviewDecisionRecords(input: {
  rows: unknown[];
  carriedOverVersionNumberById?: Map<string, number>;
}): TakeoffDpgfReviewDecisionRecord[] {
  return input.rows.map((row) =>
    buildTakeoffDpgfReviewDecisionRecord({
      row,
      carriedOverVersionNumberById: input.carriedOverVersionNumberById,
    })
  );
}

export function normalizeTakeoffDpgfEstimateItemRow(row: unknown) {
  return parseWithSchema(
    takeoffDpgfCompareEstimateItemRowSchema,
    row,
    "Données estimate_items invalides en base pour la comparaison DPGF."
  );
}

export function normalizeTakeoffDpgfMappedRows(rows: unknown[]) {
  return rows.map((row) =>
    parseWithSchema(
      takeoffDpgfCompareMappedRowSchema,
      row,
      "Données dpgf_rows_mapped invalides en base."
    )
  );
}

function toNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function resolveMappedRowPayload(payload: Record<string, unknown>) {
  const embedded = payload.mapped_row;
  return isRecord(embedded) ? embedded : payload;
}

function extractDpgfMappedRowIndex(payload: Record<string, unknown>) {
  const candidate = resolveMappedRowPayload(payload).row_index;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return Math.max(0, Math.trunc(candidate));
  }

  return null;
}

function extractDpgfMappedRowUnit(payload: Record<string, unknown>) {
  const mappedRow = resolveMappedRowPayload(payload);
  return (
    toNullableText(mappedRow.unit) ??
    toNullableText(mappedRow.unite) ??
    toNullableText(mappedRow.uom) ??
    toNullableText(mappedRow.measure_unit)
  );
}

export function buildDpgfUnitByRowIndex(rows: Array<{ payload: Record<string, unknown> }>) {
  const unitByRowIndex = new Map<number, string | null>();

  for (const row of rows) {
    const rowIndex = extractDpgfMappedRowIndex(row.payload);
    if (rowIndex === null || unitByRowIndex.has(rowIndex)) {
      continue;
    }

    unitByRowIndex.set(rowIndex, extractDpgfMappedRowUnit(row.payload));
  }

  return unitByRowIndex;
}

export function normalizeDpgfComparisonEstimateItems(input: {
  rows: Array<z.infer<typeof takeoffDpgfCompareEstimateItemRowSchema>>;
  unitByRowIndex: Map<number, string | null>;
}): TakeoffDpgfComparisonDpgfLine[] {
  return input.rows
    .filter((row) => {
      if (row.item_type !== "line") return false;
      if (toPositiveNumber(row.quantity) === null) return false;

      return row.source_provider === "dpgf";
    })
    .map((row) => ({
      estimate_item_id: row.id,
      title: row.title,
      description: row.description,
      quantity: row.quantity as number,
      unit:
        typeof row.source_page === "number"
          ? input.unitByRowIndex.get(row.source_page) ?? null
          : null,
      source_page: row.source_page,
      source_file_name: row.source_file_name,
      position: row.position,
    }));
}

export function normalizeTakeoffComparisonItems(items: TakeoffJobItem[]): TakeoffDpgfComparisonTakeoffLine[] {
  return items.map((item) => ({
    item_id: item.id,
    designation: item.designation,
    quantity: item.quantity,
    unit: item.unit,
    source_page: item.source_page,
    source_file_name: item.source_file_name,
    confidence: item.confidence,
    evidence: item.evidence,
    metadata: item.metadata,
  }));
}

export function getCarriedOverVersionIds(rows: unknown[]): string[] {
  return rows.flatMap((row) =>
    isRecord(row) &&
    typeof row.carried_over_from_version_id === "string" &&
    row.carried_over_from_version_id.trim().length > 0
      ? [row.carried_over_from_version_id]
      : []
  );
}

export function carryTakeoffDpgfReviewDecisions(input: {
  decisions: TakeoffDpgfReviewDecisionRecord[];
  linkedFromVersionId: string;
  linkedFromVersionNumber: number | null;
}): TakeoffDpgfReviewDecisionRecord[] {
  return input.decisions.map((decision) => ({
    ...decision,
    source: "carried_over",
    carried_over_from_version_id:
      decision.carried_over_from_version_id ?? input.linkedFromVersionId,
    carried_over_from_version_number:
      decision.carried_over_from_version_number ?? input.linkedFromVersionNumber,
  }));
}

export function hydrateTakeoffDpgfComparisonSummary(
  comparison: TakeoffDpgfComparisonResponse,
  hydratedRows: TakeoffDpgfComparisonResponse["rows"]
): TakeoffDpgfComparisonResponse {
  const hydratedLinesWithoutProof = hydratedRows.filter((row) =>
    row.proofs.every((proof) => proof.type === "dpgf")
  ).length;
  const baseLinesWithoutProof = comparison.rows.filter((row) =>
    row.proofs.every((proof) => proof.type === "dpgf")
  ).length;

  return {
    ...comparison,
    summary: {
      ...comparison.summary,
      lines_without_proof: Math.max(
        0,
        comparison.summary.lines_without_proof +
          (hydratedLinesWithoutProof - baseLinesWithoutProof)
      ),
    },
    rows: hydratedRows,
  };
}
