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

export function resolveMappedRowPayload(payload: Record<string, unknown>) {
  const embedded = payload.mapped_row;
  return isRecord(embedded) ? embedded : payload;
}

function extractDpgfMappedRowIndex(payload: Record<string, unknown>) {
  const candidate = payload.row_index ?? resolveMappedRowPayload(payload).row_index;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return Math.max(0, Math.trunc(candidate));
  }

  return null;
}

export function extractDpgfMappedRowUnit(payload: Record<string, unknown>) {
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

// Legacy imports reference their exact mapping. An edited estimate quantity cannot
// stand in for the original cell when that mapped row no longer exists.
export function legacyMappedRowId(row: TakeoffDpgfEstimateItem): string | null {
  if (row.item_type !== "line" || row.source_provider !== "dpgf" ||
      (row.source_metadata?.dpgf_source_unit !== undefined && row.source_metadata?.dpgf_source_quantity !== undefined)) return null;
  const parsed = z.string().uuid().safeParse(row.source_metadata?.mapped_row_id);
  return parsed.success ? parsed.data : null;
}

export function normalizeDpgfComparisonEstimateItems(input: {
  rows: TakeoffDpgfEstimateItem[];
  legacyUnits: ReadonlyMap<string | null, Map<number, string | null>>;
  mappedFacts: ReadonlyMap<string, { quantity: number | null; unit: string | null }>;
}): TakeoffDpgfComparisonDpgfLine[] {
  return input.rows
    .filter(row => row.item_type === "line" && row.source_provider === "dpgf")
    .map(row => {
      const facts = input.mappedFacts.get(legacyMappedRowId(row) ?? "");
      const metadata = row.source_metadata;
      const original = metadata?.dpgf_source_quantity;
      const quantity = original === undefined ? facts?.quantity ?? null :
        typeof original === "number" && Number.isFinite(original) && original >= 0 ? original : null;
      // A PDF page can contain many rows, and is never an index into a DPGF mapping.
      const legacyUnit = typeof row.source_page === "number" && !row.source_file_name?.toLowerCase().endsWith(".pdf")
        ? input.legacyUnits.get(row.source_file_name)?.get(row.source_page) ?? null : null;
      const unit = metadata?.dpgf_source_unit !== undefined
        ? toNullableText(metadata.dpgf_source_unit) : facts ? facts.unit : legacyUnit;
      return {
        estimate_item_id: row.id,
        title: row.title,
        description: row.description,
        quantity,
        unit,
        source_page: row.source_page,
        source_file_name: row.source_file_name,
        position: row.position,
      };
    });
}

export function normalizeTakeoffComparisonItems(items: TakeoffJobItem[]): TakeoffDpgfComparisonTakeoffLine[] {
  return items.filter(item => !item.is_excluded).map((item) => ({
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
  sourceItems: TakeoffDpgfEstimateItem[];
  linkedFromVersionId: string;
  linkedFromVersionNumber: number | null;
}): TakeoffDpgfReviewDecisionRecord[] {
  const identity = (file: string | null, page: number | null, title: string, position: number) =>
    JSON.stringify([file, page, title, position]);
  const unique = new Map<string, string | null>();
  for (const line of input.sourceItems) {
    if (line.item_type !== "line" || line.source_provider !== "dpgf") continue;
    const key = identity(line.source_file_name, line.source_page, line.title, line.position);
    unique.set(key, unique.has(key) ? null : line.id);
  }
  return input.decisions.filter(d =>
    unique.get(identity(d.source_file_name, d.source_page, d.line_label, d.line_position)) === d.estimate_item_id
  ).map((decision) => ({
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
