import { PassThrough, Readable } from "node:stream";

import {
  computeEstimateLineValues,
  hasActiveLaborSplitPayload,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
} from "@/lib/estimate-calculations";
import {
  resolveEstimateEngineVersion,
  shouldPreserveStoredEstimateV2Snapshot,
} from "@/lib/estimates/calc-engine-version";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import {
  alternativePriceForLineUnit,
  type SupplierOfferPurchaseUnit,
} from "@/lib/estimates/supplier-offer-purchase-unit";
import {
  ESTIMATE_EXPORT_PROGRESS_COMPLETE,
  ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
  createWorkbookWriterFactory,
  type EstimateExportStreamResult,
  type WorkbookWriterFactory,
} from "@/lib/estimates/export-stream";
import { getEstimateSupplierComparisons, getEstimateVersionDetails } from "@/lib/estimates/server";
import { loadSupplierExportSearch, mayMatchSupplierExportSearch } from "@/lib/estimates/supplier-export-search";
import { ESTIMATE_V3_STATUS_DOCUMENT_LABELS } from "@/lib/estimates/v3-document-presentation";
import {
  amountsSourceLabel,
  currencyOf,
  depthsOf,
  documentOrder,
  ESTIMATE_V3_CURRENCY_FORMATS,
  euros,
  footerEntries,
  loadEstimateV3ExportDocument,
  usesEstimateV3LaborSplit,
  type EstimateV3ExportDocument,
} from "@/lib/estimates/v3-export";
import { ESTIMATE_VAT_REVERSE_CHARGE_NOTICE } from "@/lib/estimates/document-copy";

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

type SupplierAlternative = SupplierOfferPurchaseUnit & {
  supplier_price_id: string;
  supplier_name: string;
  adjusted_unit_price_cents: number;
  unit_price_cents?: number | null;
  adjusted_purchase_unit_price_cents?: number | null;
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
  /** Lot 2, sous-lot 2.7b : colonnes propres à une v3, ajoutées après « Ref interne ». */
  v3?: { status: string; hoursPerUnit: number | null; saleUnitPriceEur: number | null };
};

type BdcExportPayload = {
  projectName: string;
  projectReference: string | null;
  versionNumber: number;
  rows: BdcExportRow[];
  /** Lot 2, sous-lot 2.7b : document v3 dont viennent les lignes (aucun montant recalculé ici). */
  v3?: { document: EstimateV3ExportDocument };
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
        `Atelier: ${laborRoleNameById.get(item.labor_role_atelier_id) ?? "Rôle atelier"}`
      );
    }
    if (item.labor_role_chantier_id) {
      parts.push(
        `Chantier: ${laborRoleNameById.get(item.labor_role_chantier_id) ?? "Rôle chantier"}`
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

function styleWorksheetHeader(worksheet: WorksheetLike, engineV3 = false) {
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

  if (engineV3) {
    // Lot 2, sous-lot 2.7b : colonnes v3 après « Ref interne » ; les totaux sont ceux du document v3, sans la
    // formule indicative V1.1.
    applyHeaderFill(headerRow, 32, 34, "FF0F766E");
    const notes: Array<[number, string]> = [
      [16, "Moteur 3 : brut FO du document (Q × PR FO × K FO × coefficient de vente FO, réparti sur le brut de ligne)"],
      [17, "Moteur 3 : brut MO du document (brut de ligne − brut FO)"],
      [18, "Moteur 3 : brut de ligne du document (Q × PU vente), avant remise commerciale"],
    ];
    for (const [column, note] of notes) {
      const cell = headerRow.getCell?.(column);
      if (cell) cell.note = note;
    }
    headerRow.commit();
    return;
  }

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
  rank: 0 | 1 | 2,
  lineUnit: string | null | undefined
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
    // 2.9: the supplier price in the unit of the line (per metre, or per bar for a line in bars).
    unitPriceEur: toEuroAmount(alternativePriceForLineUnit(alternative, lineUnit).priceCents),
    url: alternative.catalogue_url ?? "",
  };
}

function resolveExportAid(item: EstimateItemRecord) {
  const aid = (item as EstimateItemRecord & { aid?: string | null }).aid;
  if (typeof aid !== "string") return item.id;
  const normalized = aid.trim();
  return normalized.length > 0 ? normalized : item.id;
}

export async function getSupplierComparisonsForExport(
  versionId: string,
  lineItemIds: string[],
  items?: ReadonlyArray<{ id: string; title: string; selected_supplier_price_id?: string | null }>,
) {
  if (lineItemIds.length === 0) {
    return [] as SupplierComparison[];
  }

  const itemById = new Map(items?.map(item => [item.id, item]));
  const search = items && lineItemIds.length > SUPPLIER_COMPARISON_BATCH_SIZE
    ? await loadSupplierExportSearch() : null;
  const candidateIds = lineItemIds.filter(id => {
    const item = itemById.get(id);
    // A retained offer is resolved even when its title has no current search
    // match. Unknown metadata must also keep the original comparison path.
    return !item || item.selected_supplier_price_id === undefined || item.selected_supplier_price_id
      || mayMatchSupplierExportSearch(search, item.title);
  });
  const comparisons: SupplierComparison[] = [];
  for (
    let startIndex = 0;
    startIndex < candidateIds.length;
    startIndex += SUPPLIER_COMPARISON_BATCH_SIZE
  ) {
    const batchItemIds = candidateIds.slice(
      startIndex,
      startIndex + SUPPLIER_COMPARISON_BATCH_SIZE
    );
    const batchResult = await getEstimateSupplierComparisons(versionId, batchItemIds);
    comparisons.push(...(batchResult.comparisons as SupplierComparison[]));
  }

  const byId = new Map(comparisons.map(comparison => [comparison.item_id, comparison]));
  return lineItemIds.map(id => byId.get(id) ?? {
    item_id: id, selected_supplier_price_id: null, alternatives: [],
  });
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
    const supplier1 = resolveSupplierByRank(comparison, 0, item.description);
    const supplier2 = resolveSupplierByRank(comparison, 1, item.description);
    const supplier3 = resolveSupplierByRank(comparison, 2, item.description);

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

/**
 * Lot 2, sous-lot 2.7b (A10, D-a) : lignes BDC V1.1 d'une v3, lues dans le document v3 (gel, ou aperçu d'un brouillon
 * modifié depuis son gel), jamais recalculées par le moteur v1/v2 (D12). Unité du référentiel (`unit_code`), PR FO saisi,
 * K FO et K MO saisis, FO, MO (= brut − FO) et HT bruts du document ; « h MO » et « Taux horaire MO » restent vides (les
 * heures par unité et le statut vont dans les colonnes v3). Ligne ventilée au déclenchement du moteur
 * (`usesEstimateV3LaborSplit` : drapeau du calcul, heures, rôle ou K MO atelier/chantier) : rôles « Atelier : … /
 * Chantier : … », h/u additionnées et K MO pondéré par les heures, comme le BDC d'une v1/v2. Une ligne non chiffrée porte
 * 0 € et son libellé de statut, sans prix ni heures. Les prix fournisseurs sont ramenés à l'unité de la ligne (2.9).
 */
function buildBdcV3Rows(input: {
  document: EstimateV3ExportDocument;
  supplyTypeById: Map<string, string>;
  laborRoleNameById: Map<string, string>;
  categoryById: Map<string, string>;
  comparisonByItemId: Map<string, SupplierComparison>;
}): BdcExportRow[] {
  const { prepared } = input.document;
  const depths = depthsOf(input.document.items);
  const roleName = (id: string | null | undefined, fallback: string) =>
    id ? (input.laborRoleNameById.get(id) ?? fallback) : "";
  return documentOrder(input.document.items).map((item): BdcExportRow => {
    const depth = depths.get(item.id) ?? 0;
    const designation = `${depth > 0 ? "  ".repeat(depth) : ""}${item.title}`;
    const aid = resolveExportAid(item as unknown as EstimateItemRecord);
    if (item.item_type !== "line") {
      return {
        type: "section", position: item.position, aid, designation, unite: "", quantite: null, typeFo: "",
        puFoHtEur: null, prFoHtEur: null, kFo: null, hMo: null, kMo: null, tauxHoraireMoEur: null, roleMo: "",
        categorie: "", totalFoHtEur: null, totalMoHtEur: null, totalHtEur: null,
        supplier1Name: "", supplier1PriceEur: null, supplier1Ref: "", supplier1Url: "",
        supplier2Name: "", supplier2PriceEur: null, supplier2Ref: "", supplier2Url: "",
        supplier3Name: "", supplier3PriceEur: null, supplier3Ref: "", supplier3Url: "",
        refInterne: item.id, isSection: true, v3: { status: "", hoursPerUnit: null, saleUnitPriceEur: null },
      };
    }
    const line = prepared.v3.linesById[item.id];
    const priced = line.pricingStatus === "priced";
    const split = usesEstimateV3LaborSplit(input.document, item);
    const roleMo = split
      ? [item.labor_role_atelier_id ? `Atelier: ${roleName(item.labor_role_atelier_id, "Rôle atelier")}` : "",
        item.labor_role_chantier_id ? `Chantier: ${roleName(item.labor_role_chantier_id, "Rôle chantier")}` : ""]
        .filter(Boolean).join(" / ")
      : roleName(item.labor_role_id, "");
    const hoursAtelier = Number(item.h_mo_atelier_per_unit ?? 0);
    const hoursChantier = Number(item.h_mo_chantier_per_unit ?? 0);
    const hoursPerUnit = split ? hoursAtelier + hoursChantier : (item.h_mo_per_unit ?? null);
    // Même K MO de ligne ventilée que le BDC v1/v2 (`resolveLaborCoefficient`) : pondéré par les heures, 1 sans heures.
    const kMo = !split ? (item.k_mo ?? 1) : hoursAtelier + hoursChantier <= 0 ? 1
      : (hoursAtelier * Number(item.k_mo_atelier ?? 1) + hoursChantier * Number(item.k_mo_chantier ?? 1))
        / (hoursAtelier + hoursChantier);
    const comparison = input.comparisonByItemId.get(item.id);
    const [supplier1, supplier2, supplier3] = ([0, 1, 2] as const)
      .map((rank) => resolveSupplierByRank(comparison, rank, line.unitCode));
    return {
      type: "line", position: item.position, aid, designation,
      unite: line.unitCode ?? "",
      quantite: toNullableNumber(item.quantity),
      typeFo: item.supply_type_id ? (input.supplyTypeById.get(item.supply_type_id) ?? "") : "",
      puFoHtEur: priced ? euros(item.unit_price_ht_cents) : null,
      prFoHtEur: priced ? euros(item.unit_price_ht_cents) : null,
      kFo: item.k_fo ?? 1,
      hMo: null,
      kMo,
      tauxHoraireMoEur: null,
      roleMo,
      categorie: item.category_id ? (input.categoryById.get(item.category_id) ?? "") : "",
      totalFoHtEur: euros(line.foSaleHtCents),
      totalMoHtEur: euros(line.moSaleHtCents),
      totalHtEur: euros(line.saleHtCents),
      supplier1Name: supplier1.name, supplier1PriceEur: supplier1.unitPriceEur, supplier1Ref: supplier1.reference, supplier1Url: supplier1.url,
      supplier2Name: supplier2.name, supplier2PriceEur: supplier2.unitPriceEur, supplier2Ref: supplier2.reference, supplier2Url: supplier2.url,
      supplier3Name: supplier3.name, supplier3PriceEur: supplier3.unitPriceEur, supplier3Ref: supplier3.reference, supplier3Url: supplier3.url,
      refInterne: item.id,
      isSection: false,
      v3: {
        status: ESTIMATE_V3_STATUS_DOCUMENT_LABELS[line.pricingStatus],
        hoursPerUnit: priced ? hoursPerUnit : null,
        saleUnitPriceEur: priced ? euros(line.unitSaleHtCents) : null,
      },
    };
  });
}

/** Colonnes ajoutées après « Ref interne » pour une v3 (l'en-tête V1.1 reste intact et dans son ordre). */
function bdcV3Columns(currency: string) {
  return [
    { header: "Statut", key: "statut_v3", width: 16 },
    { header: "h MO / unité", key: "h_mo_per_unit_v3", width: 14 },
    { header: `PU vente HT ${currency}`, key: "pu_vente_ht_v3", width: 18 },
  ];
}

async function writeWorkbook(input: {
  payload: BdcExportPayload;
  stream: NodeJS.WritableStream;
  workbookWriterFactory: WorkbookWriterFactory;
}) {
  const workbook = (await input.workbookWriterFactory(input.stream)) as WorkbookWriterLike;
  const v3 = input.payload.v3;

  const bdcSheet = workbook.addWorksheet("BDC_V1_1");
  bdcSheet.columns = [
    { header: "Type", key: "type", width: 10 },
    { header: "Position", key: "position", width: 10 },
    { header: "AID", key: "aid", width: 38 },
    { header: "Désignation", key: "designation", width: 42 },
    { header: "Unité", key: "unite", width: 12 },
    { header: "Quantité", key: "quantite", width: 12 },
    { header: "Type FO", key: "type_fo", width: 14 },
    { header: "PU FO HT EUR", key: "pu_fo_ht_eur", width: 16 },
    { header: "PR FO HT EUR", key: "pr_fo_ht_eur", width: 16 },
    { header: "K FO", key: "k_fo", width: 10 },
    { header: "h MO", key: "h_mo", width: 10 },
    { header: "K MO", key: "k_mo", width: 10 },
    { header: "Taux horaire MO EUR", key: "taux_horaire_mo_eur", width: 20 },
    { header: "Rôle MO", key: "role_mo", width: 24 },
    { header: "Catégorie", key: "categorie", width: 20 },
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
    ...(v3 ? bdcV3Columns(currencyOf(v3.document)) : []),
  ];
  styleWorksheetHeader(bdcSheet, v3 !== undefined);

  let rowNumber = 1;
  input.payload.rows.forEach((row) => {
    rowNumber += 1;
    const v3Cells = v3 ? [row.v3?.status ?? "", row.v3?.hoursPerUnit ?? null, row.v3?.saleUnitPriceEur ?? null] : [];
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
      ...v3Cells,
    ]);

    if (row.isSection) {
      bdcRow.font = {
        bold: true,
      };
    } else if (v3) {
      // v3 : montants du document au format de la devise de la version ; aucune formule indicative V1.1 (D12).
      const money = ESTIMATE_V3_CURRENCY_FORMATS[currencyOf(v3.document)];
      setCellNumberFormat(bdcRow, 2, "0");
      setCellNumberFormat(bdcRow, 6, "0.###");
      for (const column of [10, 12, 33]) setCellNumberFormat(bdcRow, column, "0.###");
      for (const column of [8, 9, 16, 17, 18, 20, 24, 28, 34]) setCellNumberFormat(bdcRow, column, money);
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

  if (v3) {
    // v3 : source des montants (gel ou aperçu non figé), coefficients de vente et pied du document, sans recalcul.
    const { document } = v3;
    const money = ESTIMATE_V3_CURRENCY_FORMATS[currencyOf(document)];
    const summary = workbook.addWorksheet("Resume");
    summary.columns = [{ header: "Champ", key: "field", width: 40 }, { header: "Valeur", key: "value", width: 32 }];
    const header = summary.getRow?.(1);
    if (header) {
      applyHeaderFill(header, 1, 2, "FF1E3A8A");
      header.commit();
    }
    const footer = footerEntries(document);
    const rows: Array<[string, string | number, boolean]> = [
      ["Moteur de calcul", 3, false],
      ["Montants", amountsSourceLabel(document), false],
      ["Coefficient de vente FO", Number(document.version.sale_coefficient_fo ?? 0), false],
      ["Coefficient de vente MO", Number(document.version.sale_coefficient_mo ?? 0), false],
      ...footer.map(([label, amount]): [string, number, boolean] => [label, amount, true]),
      ...(document.prepared.v3.totals.reverseCharge
        ? [["Régime de TVA", ESTIMATE_VAT_REVERSE_CHARGE_NOTICE, false] as [string, string, boolean]] : []),
    ];
    for (const [field, value, isMoney] of rows) {
      const summaryRow = summary.addRow([field, value]);
      if (isMoney) setCellNumberFormat(summaryRow, 2, money);
      summaryRow.commit();
    }
    summary.commit();
  }

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
  const supplyTypeById = new Map(
    (details.supply_types ?? []).map((supplyType) => [supplyType.id, supplyType.name])
  );
  const laborRoleNameById = new Map(
    (details.labor_roles ?? []).map((role) => [role.id, role.name])
  );
  const categoryById = new Map(
    (details.categories ?? []).map((category) => [category.id, category.name])
  );
  // Lot 2, sous-lot 2.7b : une v3 est aiguillée avant tout garde ou calcul v1/v2 (computeEstimateLineValues,
  // shouldPreserveStoredEstimateV2Snapshot) vers son document ; ses montants ne sont jamais recalculés ici (D12).
  if (usesSaleCoefficients(resolveEstimateEngineVersion(details.version))) {
    const document = await loadEstimateV3ExportDocument(versionId);
    const v3LineIds = document.items.filter((item) => item.item_type === "line").map((item) => item.id);
    const v3Comparisons = await getSupplierComparisonsForExport(versionId, v3LineIds, document.items);
    return {
      projectName: details.version.estimate_projects.name,
      projectReference: details.version.estimate_projects.reference,
      versionNumber: details.version.version_number,
      rows: buildBdcV3Rows({
        document,
        supplyTypeById,
        laborRoleNameById,
        categoryById,
        comparisonByItemId: new Map(v3Comparisons.map((comparison) => [comparison.item_id, comparison])),
      }),
      v3: { document },
    };
  }
  const preserveStoredSnapshot =
    shouldPreserveStoredEstimateV2Snapshot(details.version);
  const lineItemIds = items
    .filter((item) => item.item_type === "line")
    .map((item) => item.id);

  const supplierComparisons = await getSupplierComparisonsForExport(versionId, lineItemIds, items);

  const comparisonByItemId = new Map(
    supplierComparisons.map((comparison) => [comparison.item_id, comparison])
  );
  const laborRateById = new Map(
    (details.labor_roles ?? []).map((role) => [role.id, role.hourly_rate_cents ?? 0])
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
