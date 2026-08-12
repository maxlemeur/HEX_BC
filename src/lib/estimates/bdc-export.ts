import { PassThrough, Readable } from "node:stream";

import {
  computeEstimateLineValues,
  hasActiveLaborSplitPayload,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
} from "@/lib/estimate-calculations";
import { shouldPreserveStoredEstimateV2Snapshot } from "@/lib/estimates/calc-engine-version";
import {
  ESTIMATE_EXPORT_PROGRESS_COMPLETE,
  ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
  createWorkbookWriterFactory,
  type EstimateExportStreamResult,
  type WorkbookWriterFactory,
} from "@/lib/estimates/export-stream";
import { getEstimateSupplierComparisons, getEstimateVersionDetails } from "@/lib/estimates/server";

type WorksheetRowValue = Record<string, unknown> | unknown[];

type WorksheetCellLike = {
  numFmt?: string;
  note?: string;
  font?: {
    bold?: boolean;
    color?: { argb: string };
  };
  fill?: {
    type: "pattern";
    pattern: "solid";
    fgColor: { argb: string };
  };
  alignment?: {
    horizontal?: "left" | "center" | "right";
  };
};

type WorksheetRowLike = {
  commit: () => void;
  font?: {
    bold?: boolean;
  };
  getCell?: (index: number) => WorksheetCellLike;
  eachCell?: (callback: (cell: WorksheetCellLike) => void) => void;
};

type WorksheetLike = {
  columns?: Array<{ header: string; key: string; width?: number }>;
  addRow: (value: WorksheetRowValue) => WorksheetRowLike;
  getRow?: (index: number) => WorksheetRowLike;
  commit: () => void;
};

type WorkbookWriterLike = {
  addWorksheet: (name: string) => WorksheetLike;
  commit: () => Promise<void>;
};

type SupplierAlternative = {
  supplier_price_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  supplier_reference: string | null;
  catalogue_url?: string | null;
};

type SupplierComparison = {
  item_id: string;
  selected_supplier_price_id: string | null;
  alternatives: SupplierAlternative[];
};

type BdcExportRow = {
  type: "section" | "line";
  position: number;
  aid: string;
  designation: string;
  unite: string;
  quantite: number | null;
  typeFo: string;
  puFoHtEur: number | null;
  prFoHtEur: number | null;
  kFo: number | null;
  hMo: number | null;
  kMo: number | null;
  tauxHoraireMoEur: number | null;
  roleMo: string;
  categorie: string;
  totalFoHtEur: number | null;
  totalMoHtEur: number | null;
  totalHtEur: number | null;
  supplier1Name: string;
  supplier1PriceEur: number | null;
  supplier1Ref: string;
  supplier1Url: string;
  supplier2Name: string;
  supplier2PriceEur: number | null;
  supplier2Ref: string;
  supplier2Url: string;
  supplier3Name: string;
  supplier3PriceEur: number | null;
  supplier3Ref: string;
  supplier3Url: string;
  refInterne: string;
  isSection: boolean;
};

type BdcExportPayload = {
  projectName: string;
  projectReference: string | null;
  versionNumber: number;
  rows: BdcExportRow[];
};

const SUPPLIER_COMPARISON_BATCH_SIZE = 200;

function toSafeString(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized;
}

function sanitizeFilenameSegment(value: string | null | undefined, fallback: string) {
  const safe = toSafeString(value, fallback);
  const normalized = safe
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "_")
    .replaceAll(/_{2,}/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function buildFilename(input: {
  projectReference: string | null;
  projectName: string;
  versionNumber: number;
}) {
  const sourceName =
    input.projectReference && input.projectReference.trim().length > 0
      ? input.projectReference
      : input.projectName;
  const projectToken = sanitizeFilenameSegment(sourceName, "chiffrage");
  return `devis-${projectToken}-v${input.versionNumber}-bdc-v1_1.xlsx`;
}

function toNullableNumber(value: number | null | undefined): number | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  return value ?? null;
}

function toEuroAmount(valueCents: number | null | undefined): number | null {
  if (!Number.isFinite(valueCents ?? NaN)) return null;
  return (valueCents ?? 0) / 100;
}

function resolveDepthByItemId(items: EstimateItemRecord[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (itemId: string): number => {
    const cached = depthById.get(itemId);
    if (cached !== undefined) return cached;
    if (visiting.has(itemId)) return 0;

    visiting.add(itemId);
    const item = itemById.get(itemId);
    if (!item || !item.parent_id) {
      depthById.set(itemId, 0);
      visiting.delete(itemId);
      return 0;
    }

    const parent = itemById.get(item.parent_id);
    const parentDepth = parent ? visit(parent.id) : 0;
    const depth = parent ? parentDepth + 1 : 0;
    depthById.set(itemId, depth);
    visiting.delete(itemId);
    return depth;
  };

  items.forEach((item) => {
    visit(item.id);
  });

  return depthById;
}

function usesLaborSplit(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  return isLaborSplitEnabled && hasActiveLaborSplitPayload(item);
}

function resolveLaborRoleLabel(
  item: EstimateItemRecord,
  laborRoleNameById: Map<string, string>,
  isLaborSplitEnabled: boolean
) {
  if (usesLaborSplit(item, isLaborSplitEnabled)) {
    const parts: string[] = [];
    if (item.labor_role_atelier_id) {
      parts.push(
        `Atelier: ${laborRoleNameById.get(item.labor_role_atelier_id) ?? "Role atelier"}`
      );
    }
    if (item.labor_role_chantier_id) {
      parts.push(
        `Chantier: ${laborRoleNameById.get(item.labor_role_chantier_id) ?? "Role chantier"}`
      );
    }
    return parts.join(" / ");
  }

  if (!item.labor_role_id) return "";
  return laborRoleNameById.get(item.labor_role_id) ?? "";
}

function resolveLaborHours(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  if (usesLaborSplit(item, isLaborSplitEnabled)) {
    return (item.h_mo_atelier ?? 0) + (item.h_mo_chantier ?? 0);
  }
  return item.h_mo ?? 0;
}

function resolveLaborCoefficient(
  item: EstimateItemRecord,
  isLaborSplitEnabled: boolean
) {
  if (!usesLaborSplit(item, isLaborSplitEnabled)) {
    return item.k_mo ?? 1;
  }

  const hAtelier = item.h_mo_atelier ?? 0;
  const hChantier = item.h_mo_chantier ?? 0;
  const totalHours = hAtelier + hChantier;
  if (totalHours <= 0) return 1;

  const kAtelier = item.k_mo_atelier ?? 1;
  const kChantier = item.k_mo_chantier ?? 1;
  return (hAtelier * kAtelier + hChantier * kChantier) / totalHours;
}

function resolveLaborHourlyRateCents(input: {
  item: EstimateItemRecord;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled: boolean;
}) {
  const { item, laborRateById, isLaborSplitEnabled } = input;

  if (!usesLaborSplit(item, isLaborSplitEnabled)) {
    const legacyRate = item.labor_role_id ? (laborRateById.get(item.labor_role_id) ?? 0) : 0;
    return legacyRate;
  }

  const hAtelier = item.h_mo_atelier ?? 0;
  const hChantier = item.h_mo_chantier ?? 0;
  const rateAtelier = item.labor_role_atelier_id
    ? (laborRateById.get(item.labor_role_atelier_id) ?? 0)
    : 0;
  const rateChantier = item.labor_role_chantier_id
    ? (laborRateById.get(item.labor_role_chantier_id) ?? 0)
    : 0;
  const totalHours = hAtelier + hChantier;

  if (totalHours <= 0) {
    return rateAtelier > 0 ? rateAtelier : rateChantier;
  }

  return Math.round((hAtelier * rateAtelier + hChantier * rateChantier) / totalHours);
}

function applyHeaderFill(
  row: WorksheetRowLike,
  fromColumn: number,
  toColumn: number,
  color: string,
  textColor = "FFFFFFFF"
) {
  for (let columnIndex = fromColumn; columnIndex <= toColumn; columnIndex += 1) {
    const cell = row.getCell?.(columnIndex);
    if (!cell) continue;
    cell.font = {
      bold: true,
      color: { argb: textColor },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: color },
    };
    cell.alignment = {
      horizontal: "left",
    };
  }
}

function styleWorksheetHeader(worksheet: WorksheetLike) {
  const headerRow = worksheet.getRow?.(1);
  if (!headerRow) return;

  // Identification
  applyHeaderFill(headerRow, 1, 6, "FF1E3A8A");
  // FO
  applyHeaderFill(headerRow, 7, 10, "FF15803D");
  // MO
  applyHeaderFill(headerRow, 11, 15, "FFFACC15", "FF111827");
  // Totaux
  applyHeaderFill(headerRow, 16, 18, "FFB91C1C");
  // Fournisseurs
  applyHeaderFill(headerRow, 19, 30, "FF7E22CE");
  // Ref interne
  applyHeaderFill(headerRow, 31, 31, "FF334155");

  const totalFoCell = headerRow.getCell?.(16);
  if (totalFoCell) {
    totalFoCell.note = "Formule indicative: =F{row}*H{row}*J{row}";
  }
  const totalMoCell = headerRow.getCell?.(17);
  if (totalMoCell) {
    totalMoCell.note = "Formule indicative: =K{row}*L{row}*M{row}";
  }
  const totalHtCell = headerRow.getCell?.(18);
  if (totalHtCell) {
    totalHtCell.note = "Formule indicative: =P{row}+Q{row}";
  }

  headerRow.commit();
}

function setCellNumberFormat(row: WorksheetRowLike, columnIndex: number, numFmt: string) {
  const cell = row.getCell?.(columnIndex);
  if (!cell) return;
  cell.numFmt = numFmt;
}

function resolveSupplierByRank(
  comparison: SupplierComparison | undefined,
  rank: 0 | 1 | 2
) {
  const alternative = comparison?.alternatives?.[rank];
  if (!alternative) {
    return {
      name: "",
      reference: "",
      unitPriceEur: null as number | null,
      url: "",
    };
  }

  return {
    name: alternative.supplier_name ?? "",
    reference: alternative.supplier_reference ?? "",
    unitPriceEur: toEuroAmount(alternative.adjusted_unit_price_cents),
    url: alternative.catalogue_url ?? "",
  };
}

function resolveExportAid(item: EstimateItemRecord) {
  const aid = (item as EstimateItemRecord & { aid?: string | null }).aid;
  if (typeof aid !== "string") return item.id;
  const normalized = aid.trim();
  return normalized.length > 0 ? normalized : item.id;
}

async function getSupplierComparisonsForExport(versionId: string, lineItemIds: string[]) {
  if (lineItemIds.length === 0) {
    return [] as SupplierComparison[];
  }

  const comparisons: SupplierComparison[] = [];
  for (
    let startIndex = 0;
    startIndex < lineItemIds.length;
    startIndex += SUPPLIER_COMPARISON_BATCH_SIZE
  ) {
    const batchItemIds = lineItemIds.slice(
      startIndex,
      startIndex + SUPPLIER_COMPARISON_BATCH_SIZE
    );
    const batchResult = await getEstimateSupplierComparisons(versionId, batchItemIds);
    comparisons.push(...(batchResult.comparisons as SupplierComparison[]));
  }

  return comparisons;
}

function buildBdcRows(input: {
  items: EstimateItemRecord[];
  version: EstimateVersionForCalc & { version_number: number };
  supplyTypeById: Map<string, string>;
  laborRateById: Map<string, number>;
  laborRoleNameById: Map<string, string>;
  categoryById: Map<string, string>;
  comparisonByItemId: Map<string, SupplierComparison>;
  isLaborSplitEnabled: boolean;
  preserveStoredSnapshot?: boolean;
}) {
  const depthByItemId = resolveDepthByItemId(input.items);

  return input.items.map((item): BdcExportRow => {
    const depth = depthByItemId.get(item.id) ?? 0;
    const indentation = depth > 0 ? "  ".repeat(depth) : "";

    if (item.item_type !== "line") {
      return {
        type: "section",
        position: item.position,
        aid: resolveExportAid(item),
        designation: `${indentation}${item.title}`,
        unite: "",
        quantite: null,
        typeFo: "",
        puFoHtEur: null,
        prFoHtEur: null,
        kFo: null,
        hMo: null,
        kMo: null,
        tauxHoraireMoEur: null,
        roleMo: "",
        categorie: "",
        totalFoHtEur: null,
        totalMoHtEur: null,
        totalHtEur: null,
        supplier1Name: "",
        supplier1PriceEur: null,
        supplier1Ref: "",
        supplier1Url: "",
        supplier2Name: "",
        supplier2PriceEur: null,
        supplier2Ref: "",
        supplier2Url: "",
        supplier3Name: "",
        supplier3PriceEur: null,
        supplier3Ref: "",
        supplier3Url: "",
        refInterne: item.id,
        isSection: true,
      };
    }

    const comparison = input.comparisonByItemId.get(item.id);
    const supplier1 = resolveSupplierByRank(comparison, 0);
    const supplier2 = resolveSupplierByRank(comparison, 1);
    const supplier3 = resolveSupplierByRank(comparison, 2);

    const quantity = Math.max(toNullableNumber(item.quantity) ?? 0, 0);
    if (input.preserveStoredSnapshot) {
      const foTotalCents = Math.max(item.snapshot_fo_ht_cents ?? 0, 0);
      const totalHtCents = Math.max(item.line_total_ht_cents ?? 0, 0);
      const moTotalCents = Math.max(
        item.snapshot_mo_ht_cents ?? totalHtCents - foTotalCents,
        0
      );
      return {
        type: "line",
        position: item.position,
        aid: resolveExportAid(item),
        designation: `${indentation}${item.title}`,
        unite: item.description?.trim() ?? "",
        quantite: quantity,
        typeFo: item.supply_type_id
          ? (input.supplyTypeById.get(item.supply_type_id) ?? "")
          : "",
        puFoHtEur: toEuroAmount(
          quantity > 0 ? Math.round(foTotalCents / quantity) : 0
        ),
        prFoHtEur: toEuroAmount(
          quantity > 0 ? Math.round(foTotalCents / quantity) : 0
        ),
        kFo: 1,
        hMo: null,
        kMo: null,
        tauxHoraireMoEur: null,
        roleMo: "",
        categorie: item.category_id
          ? (input.categoryById.get(item.category_id) ?? "")
          : "",
        totalFoHtEur: toEuroAmount(foTotalCents),
        totalMoHtEur: toEuroAmount(moTotalCents),
        totalHtEur: toEuroAmount(totalHtCents),
        supplier1Name: supplier1.name,
        supplier1PriceEur: supplier1.unitPriceEur,
        supplier1Ref: supplier1.reference,
        supplier1Url: supplier1.url,
        supplier2Name: supplier2.name,
        supplier2PriceEur: supplier2.unitPriceEur,
        supplier2Ref: supplier2.reference,
        supplier2Url: supplier2.url,
        supplier3Name: supplier3.name,
        supplier3PriceEur: supplier3.unitPriceEur,
        supplier3Ref: supplier3.reference,
        supplier3Url: supplier3.url,
        refInterne: item.id,
        isSection: false,
      };
    }
    const unitPriceFoCents = Math.max(toNullableNumber(item.unit_price_ht_cents) ?? 0, 0);
    const kFo = Math.max(item.k_fo ?? 1, 0);
    const prFoCents = Math.round(unitPriceFoCents * kFo);
    const foTotalCents = Math.round(quantity * unitPriceFoCents * kFo);

    const laborRateLegacyCents = item.labor_role_id
      ? (input.laborRateById.get(item.labor_role_id) ?? 0)
      : 0;
    const laborRateAtelierCents = item.labor_role_atelier_id
      ? (input.laborRateById.get(item.labor_role_atelier_id) ?? 0)
      : 0;
    const laborRateChantierCents = item.labor_role_chantier_id
      ? (input.laborRateById.get(item.labor_role_chantier_id) ?? 0)
      : 0;

    const taxRateBp = item.tax_rate_bp ?? input.version.tax_rate_bp ?? 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: laborRateLegacyCents,
      },
      {
        marginMultiplier: input.version.margin_multiplier,
        taxRateBp,
        isLaborSplitEnabled: usesLaborSplit(item, input.isLaborSplitEnabled),
        laborRateAtelierCents,
        laborRateChantierCents,
      }
    );

    const moTotalCents = Math.max(lineValues.costLineCents - foTotalCents, 0);
    const totalHtCents = foTotalCents + moTotalCents;

    return {
      type: "line",
      position: item.position,
      aid: resolveExportAid(item),
      designation: `${indentation}${item.title}`,
      unite: item.description?.trim() ?? "",
      quantite: quantity,
      typeFo: item.supply_type_id ? (input.supplyTypeById.get(item.supply_type_id) ?? "") : "",
      puFoHtEur: toEuroAmount(unitPriceFoCents),
      prFoHtEur: toEuroAmount(prFoCents),
      kFo,
      hMo: resolveLaborHours(item, input.isLaborSplitEnabled),
      kMo: resolveLaborCoefficient(item, input.isLaborSplitEnabled),
      tauxHoraireMoEur: toEuroAmount(
        resolveLaborHourlyRateCents({
          item,
          laborRateById: input.laborRateById,
          isLaborSplitEnabled: input.isLaborSplitEnabled,
        })
      ),
      roleMo: resolveLaborRoleLabel(
        item,
        input.laborRoleNameById,
        input.isLaborSplitEnabled
      ),
      categorie: item.category_id ? (input.categoryById.get(item.category_id) ?? "") : "",
      totalFoHtEur: toEuroAmount(foTotalCents),
      totalMoHtEur: toEuroAmount(moTotalCents),
      totalHtEur: toEuroAmount(totalHtCents),
      supplier1Name: supplier1.name,
      supplier1PriceEur: supplier1.unitPriceEur,
      supplier1Ref: supplier1.reference,
      supplier1Url: supplier1.url,
      supplier2Name: supplier2.name,
      supplier2PriceEur: supplier2.unitPriceEur,
      supplier2Ref: supplier2.reference,
      supplier2Url: supplier2.url,
      supplier3Name: supplier3.name,
      supplier3PriceEur: supplier3.unitPriceEur,
      supplier3Ref: supplier3.reference,
      supplier3Url: supplier3.url,
      refInterne: item.id,
      isSection: false,
    };
  });
}

async function writeWorkbook(input: {
  payload: BdcExportPayload;
  stream: NodeJS.WritableStream;
  workbookWriterFactory: WorkbookWriterFactory;
}) {
  const workbook = (await input.workbookWriterFactory(input.stream)) as WorkbookWriterLike;

  const bdcSheet = workbook.addWorksheet("BDC_V1_1");
  bdcSheet.columns = [
    { header: "Type", key: "type", width: 10 },
    { header: "Position", key: "position", width: 10 },
    { header: "AID", key: "aid", width: 38 },
    { header: "Désignation", key: "designation", width: 42 },
    { header: "Unite", key: "unite", width: 12 },
    { header: "Quantité", key: "quantite", width: 12 },
    { header: "Type FO", key: "type_fo", width: 14 },
    { header: "PU FO HT EUR", key: "pu_fo_ht_eur", width: 16 },
    { header: "PR FO HT EUR", key: "pr_fo_ht_eur", width: 16 },
    { header: "K FO", key: "k_fo", width: 10 },
    { header: "h MO", key: "h_mo", width: 10 },
    { header: "K MO", key: "k_mo", width: 10 },
    { header: "Taux horaire MO EUR", key: "taux_horaire_mo_eur", width: 20 },
    { header: "Role MO", key: "role_mo", width: 24 },
    { header: "Categorie", key: "categorie", width: 20 },
    { header: "Total FO HT EUR", key: "total_fo_ht_eur", width: 18 },
    { header: "Total MO HT EUR", key: "total_mo_ht_eur", width: 18 },
    { header: "Total HT EUR", key: "total_ht_eur", width: 18 },
    { header: "Fournisseur 1 Nom", key: "fournisseur_1_nom", width: 20 },
    { header: "Fournisseur 1 Prix EUR", key: "fournisseur_1_prix", width: 20 },
    { header: "Fournisseur 1 Ref", key: "fournisseur_1_ref", width: 20 },
    { header: "Fournisseur 1 URL", key: "fournisseur_1_url", width: 30 },
    { header: "Fournisseur 2 Nom", key: "fournisseur_2_nom", width: 20 },
    { header: "Fournisseur 2 Prix EUR", key: "fournisseur_2_prix", width: 20 },
    { header: "Fournisseur 2 Ref", key: "fournisseur_2_ref", width: 20 },
    { header: "Fournisseur 2 URL", key: "fournisseur_2_url", width: 30 },
    { header: "Fournisseur 3 Nom", key: "fournisseur_3_nom", width: 20 },
    { header: "Fournisseur 3 Prix EUR", key: "fournisseur_3_prix", width: 20 },
    { header: "Fournisseur 3 Ref", key: "fournisseur_3_ref", width: 20 },
    { header: "Fournisseur 3 URL", key: "fournisseur_3_url", width: 30 },
    { header: "Ref interne", key: "ref_interne", width: 38 },
  ];
  styleWorksheetHeader(bdcSheet);

  let rowNumber = 1;
  input.payload.rows.forEach((row) => {
    rowNumber += 1;
    const bdcRow = bdcSheet.addRow([
      row.type,
      row.position,
      row.aid,
      row.designation,
      row.unite,
      row.quantite,
      row.typeFo,
      row.puFoHtEur,
      row.prFoHtEur,
      row.kFo,
      row.hMo,
      row.kMo,
      row.tauxHoraireMoEur,
      row.roleMo,
      row.categorie,
      row.totalFoHtEur,
      row.totalMoHtEur,
      row.totalHtEur,
      row.supplier1Name,
      row.supplier1PriceEur,
      row.supplier1Ref,
      row.supplier1Url,
      row.supplier2Name,
      row.supplier2PriceEur,
      row.supplier2Ref,
      row.supplier2Url,
      row.supplier3Name,
      row.supplier3PriceEur,
      row.supplier3Ref,
      row.supplier3Url,
      row.refInterne,
    ]);

    if (row.isSection) {
      bdcRow.font = {
        bold: true,
      };
    } else {
      setCellNumberFormat(bdcRow, 2, "0");
      setCellNumberFormat(bdcRow, 6, "0.###");
      setCellNumberFormat(bdcRow, 8, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 9, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 10, "0.###");
      setCellNumberFormat(bdcRow, 11, "0.###");
      setCellNumberFormat(bdcRow, 12, "0.###");
      setCellNumberFormat(bdcRow, 13, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 16, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 17, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 18, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 20, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 24, "#,##0.00 \"€\"");
      setCellNumberFormat(bdcRow, 28, "#,##0.00 \"€\"");

      const totalFoCell = bdcRow.getCell?.(16);
      if (totalFoCell) {
        totalFoCell.note = `Formule indicative: =F${rowNumber}*H${rowNumber}*J${rowNumber}`;
      }
      const totalMoCell = bdcRow.getCell?.(17);
      if (totalMoCell) {
        totalMoCell.note = `Formule indicative: =K${rowNumber}*L${rowNumber}*M${rowNumber}`;
      }
      const totalHtCell = bdcRow.getCell?.(18);
      if (totalHtCell) {
        totalHtCell.note = `Formule indicative: =P${rowNumber}+Q${rowNumber}`;
      }
    }

    bdcRow.commit();
  });
  bdcSheet.commit();

  await workbook.commit();
}

async function buildBdcExportPayload(
  versionId: string,
  isLaborSplitEnabled: boolean
): Promise<BdcExportPayload> {
  const details = await getEstimateVersionDetails(versionId, {
    includeExportCalculationContext: true,
  });
  const items = details.items as EstimateItemRecord[];
  const preserveStoredSnapshot =
    shouldPreserveStoredEstimateV2Snapshot(details.version);
  const lineItemIds = items
    .filter((item) => item.item_type === "line")
    .map((item) => item.id);

  const supplierComparisons = await getSupplierComparisonsForExport(versionId, lineItemIds);

  const comparisonByItemId = new Map(
    supplierComparisons.map((comparison) => [comparison.item_id, comparison])
  );
  const supplyTypeById = new Map(
    (details.supply_types ?? []).map((supplyType) => [supplyType.id, supplyType.name])
  );
  const laborRateById = new Map(
    (details.labor_roles ?? []).map((role) => [role.id, role.hourly_rate_cents ?? 0])
  );
  const laborRoleNameById = new Map(
    (details.labor_roles ?? []).map((role) => [role.id, role.name])
  );
  const categoryById = new Map(
    (details.categories ?? []).map((category) => [category.id, category.name])
  );

  return {
    projectName: details.version.estimate_projects.name,
    projectReference: details.version.estimate_projects.reference,
    versionNumber: details.version.version_number,
    rows: buildBdcRows({
      items,
      version: details.version as EstimateVersionForCalc & { version_number: number },
      supplyTypeById,
      laborRateById,
      laborRoleNameById,
      categoryById,
      comparisonByItemId,
      isLaborSplitEnabled:
        details.is_labor_split_enabled ?? isLaborSplitEnabled,
      preserveStoredSnapshot,
    }),
  };
}

export async function streamEstimateVersionBdcV11Xlsx(
  versionId: string,
  options?: {
    workbookWriterFactory?: WorkbookWriterFactory;
    isLaborSplitEnabled?: boolean;
  }
): Promise<EstimateExportStreamResult> {
  const payload = await buildBdcExportPayload(
    versionId,
    options?.isLaborSplitEnabled === true
  );
  const filename = buildFilename({
    projectReference: payload.projectReference,
    projectName: payload.projectName,
    versionNumber: payload.versionNumber,
  });

  const output = new PassThrough();
  const writerFactory = options?.workbookWriterFactory ?? createWorkbookWriterFactory();

  writeWorkbook({
    payload,
    stream: output,
    workbookWriterFactory: writerFactory,
  }).catch((error) => {
    output.destroy(error as Error);
  });

  const stream = Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>;

  return {
    filename,
    contentType: ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
    progress: ESTIMATE_EXPORT_PROGRESS_COMPLETE,
    stream,
  };
}
