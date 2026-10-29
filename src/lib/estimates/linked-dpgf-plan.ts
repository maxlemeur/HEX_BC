import {
  IMPORT_PREVIEW_REQUIRED_MESSAGE,
  importRequiresPreview,
  normalizeMappedRowsForEstimateCreation,
  type ImportFlowMappedRowInput,
  type ValidImportFlowLine,
} from "@/lib/affaires/import-flow";
import type { EstimateItemRecord } from "@/lib/estimate-calculations";
import type { CopiedEstimateItem } from "@/lib/estimates/copy-items-server";
import { badRequest, internalError } from "@/lib/estimates/errors";
import type { EstimateItemInsert } from "@/lib/estimates/item-write-types";

/** Normalize only the direct-import contract: preview-dependent workbooks remain refused. */
export function prepareLinkedDpgfLines(input: {
  mappedRows: ImportFlowMappedRowInput[];
  marginMultiplier: number;
  defaultTaxRateBp: number;
  v3?: { saleCoefficientFo: number; saleCoefficientMo: number };
}) {
  const { mappedRows } = input;
  if (mappedRows.length === 0) {
    throw badRequest(
      "La source DPGF liée ne contient aucune ligne mappee exploitable."
    );
  }

  const normalized = normalizeMappedRowsForEstimateCreation(mappedRows, {
    marginMultiplier: input.marginMultiplier,
    defaultTaxRateBp: input.defaultTaxRateBp,
    entry: "direct",
    ...(input.v3
      ? { engine: 3, saleCoefficientFo: input.v3.saleCoefficientFo, saleCoefficientMo: input.v3.saleCoefficientMo }
      : {}),
  });
  // No preview here: hours per unit and workbook parameters are refused, never priced at 0 €/h.
  if (importRequiresPreview(normalized)) {
    throw badRequest(IMPORT_PREVIEW_REQUIRED_MESSAGE);
  }
  const validLines = sortValidImportFlowLines(normalized.validLines);

  if (validLines.length === 0) {
    throw badRequest(
      "Aucune ligne DPGF valide à importer depuis la source liée."
    );
  }

  return { validLines, totalRows: normalized.totalRows };
}

function sortValidImportFlowLines(lines: ValidImportFlowLine[]) {
  return [...lines].sort((left, right) => {
    if (left.rowIndex !== right.rowIndex) {
      return left.rowIndex - right.rowIndex;
    }

    return left.mappedRowId.localeCompare(right.mappedRowId);
  });
}

/** Build the exact legacy-copy columns from normalized lines and caller-owned identities. */
export function prepareLinkedDpgfImportItems({ tenantId, versionId, createdSectionId,
  rootPosition, resolvedSectionTitle, filename, validLines, lineIds }: {
  tenantId: string;
  versionId: string;
  createdSectionId: string;
  rootPosition: number;
  resolvedSectionTitle: string;
  filename: string;
  validLines: readonly ValidImportFlowLine[];
  lineIds: readonly string[];
}) {
  // Every copied column is explicit (copy_estimate_items_atomic stores exactly them): the values the column
  // defaults gave the section before.
  const sectionItemPayload = {
    id: createdSectionId,
    tenant_id: tenantId,
    version_id: versionId,
    parent_id: null,
    item_type: "section",
    position: rootPosition,
    title: resolvedSectionTitle,
    aid: null,
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    tax_rate_bp: null,
    k_fo: null,
    h_mo: null,
    k_mo: null,
    h_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    source_provider: "dpgf",
    // source_job_id is reserved for takeoff_jobs FK; DPGF imports are tracked via source_file_name.
    source_job_id: null,
    source_file_name: filename,
    source_page: null,
    source_metadata: {},
    // Keep section payload explicit for strict DB payload checks/default-to-null behavior.
    h_mo_majoration: 1,
    k_mo_atelier: 1,
    k_mo_chantier: 1,
    selected_supplier_price_id: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
  } satisfies CopiedEstimateItem & EstimateItemInsert;

  const lineItemsPayload = validLines.map((line, index) => {
    const lineId = lineIds[index];
    if (!lineId) throw internalError("Impossible d'importer la source DPGF liée.");
    return {
      id: lineId,
      tenant_id: tenantId,
      version_id: versionId,
      parent_id: createdSectionId,
      item_type: "line",
      position: index + 1,
      title: line.title,
      aid: null,
      description: line.description,
      quantity: line.quantity,
      unit_price_ht_cents: line.unitPriceHtCents,
      tax_rate_bp: line.taxRateBp,
      k_fo: line.kFo,
      h_mo: line.hMo,
      h_mo_majoration: line.hMoMajoration ?? 1,
      k_mo: line.kMo,
      h_mo_atelier: null,
      k_mo_atelier: 1,
      labor_role_atelier_id: null,
      h_mo_chantier: null,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
      pu_ht_cents: line.puHtCents,
      labor_role_id: null,
      category_id: null,
      supply_type_id: null,
      selected_supplier_price_id: null,
      source_provider: "dpgf",
      // source_job_id is reserved for takeoff_jobs FK; DPGF imports are tracked via source_file_name.
      source_job_id: null,
      source_file_name: filename,
      source_page: line.rowIndex > 0 ? line.rowIndex : null,
      source_metadata: {},
      line_total_ht_cents: line.lineTotalHtCents,
      line_tax_cents: line.lineTaxCents,
      line_total_ttc_cents: line.lineTotalTtcCents,
    } satisfies CopiedEstimateItem & EstimateItemInsert & EstimateItemRecord;
  });

  return { sectionItemPayload, lineItemsPayload };
}
