import * as XLSX from "xlsx";

import { getSupplierComparisonsForExport } from "@/lib/estimates/bdc-export";
import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  buildEstimateExportFilename,
  formatSupplierAlternativeCompact,
  normalizeSupplierComparisonsByItemId,
} from "@/lib/estimates/editor-export";
import { usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { conflict } from "@/lib/estimates/errors";
import { ESTIMATE_EXPORT_PROGRESS_COMPLETE } from "@/lib/estimates/export-stream";
import { ESTIMATE_VAT_REVERSE_CHARGE_NOTICE } from "@/lib/estimates/document-copy";
import { MAJORATION_PERCENT_HEADER, majorationCoefficientToPercent } from "@/lib/estimates/majoration";
import { getEstimateVersionDetails } from "@/lib/estimates/server";
import { ESTIMATE_V3_STATUS_DOCUMENT_LABELS } from "@/lib/estimates/v3-document-presentation";
import {
  amountsSourceLabel,
  currencyOf,
  documentOrder,
  euros,
  footerEntries,
  loadEstimateV3ExportDocument,
  laborSplitEnabledOf,
  rate,
  usesEstimateV3LaborSplit,
  type EstimateV3ExportDocument,
} from "@/lib/estimates/v3-export";

/**
 * Lot 2, sous-lot 2.7b (A9, décision D-a) : CSV de l'éditeur d'une v3, écrit par le serveur depuis le document v3
 * (`loadEstimateV3ExportDocument`), comme les classeurs du 2.7. Aucun montant n'est calculé ici ni dans le navigateur :
 * PU et brut de ligne publiés, pied du document (brut, remise, arrondi commercial, HT net, TVA par taux, TTC). Unité du
 * référentiel (`unit_code`), heures par unité, statut ; une ligne non chiffrée porte le libellé de son statut au lieu
 * d'un prix (même convention que le DPGF v3 du 2.7). Document chiffré avec la ventilation atelier/chantier : colonnes
 * atelier et chantier ajoutées à la fin, comme le CSV v1/v2 ; sur une ligne ventilée (`uses_split` du moteur), h/u, rôle
 * et K MO de la ligne, que le moteur ignore, restent vides. Le CSV d'une v1/v2 reste construit par l'éditeur
 * (`editor-export.ts`) : cette route le refuse par un 409 nommé. Même écriture que ce CSV (SheetJS, « ; », BOM UTF-8).
 */

export const ESTIMATE_V3_CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
export const ESTIMATE_CSV_EXPORT_V3_ONLY = "ESTIMATE_CSV_EXPORT_V3_ONLY";

type CsvCell = string | number;

/** Colonnes atelier/chantier, ajoutées à la fin quand le document est chiffré avec la ventilation (comme en v1/v2). */
const LABOR_SPLIT_HEADER = ["h MO atelier / unité", "Rôle MO atelier", "K MO atelier", "h MO chantier / unité", "Rôle MO chantier",
  "K MO chantier"];

export function estimateV3CsvHeader(currency: string, laborSplit = false): string[] {
  return ["Chemin chapitre", "Poste", "Désignation", "Unité", "Quantité", "Statut", `Prix unitaire HT (${currency})`, "Type FO",
    "Fournisseur 1", "Fournisseur 2", "Fournisseur 3", "K FO", "h MO / unité", MAJORATION_PERCENT_HEADER, "Rôle MO", "K MO",
    `PU HT (${currency})`, `Total HT (${currency})`, "TVA (%)", ...(laborSplit ? LABOR_SPLIT_HEADER : [])];
}

/** Lignes du CSV v3 (en-tête, lignes du document, puis pied sous « Désignation » / « Total HT »). */
export function buildEstimateV3CsvRows(input: {
  document: EstimateV3ExportDocument;
  supplyTypeById: ReadonlyMap<string, string>;
  laborRoleNameById: ReadonlyMap<string, string>;
  /** Trois libellés fournisseur d'une ligne, prix ramené à l'unité de la ligne (2.9). */
  supplierLabels: (itemId: string, unitCode: string | null) => [string, string, string];
}): CsvCell[][] {
  const { document } = input;
  const { prepared } = document;
  const laborSplit = laborSplitEnabledOf(document);
  const currency = currencyOf(document);
  const header = estimateV3CsvHeader(currency, laborSplit);
  const byId = new Map(document.items.map((item) => [item.id, item]));
  const sectionPath = (parentId: string | null) => {
    const parts: string[] = [];
    for (let current = parentId, guard = 0; current !== null && guard <= document.items.length; guard += 1) {
      const parent = byId.get(current);
      if (!parent) break;
      if (parent.item_type === "section") parts.push(parent.title?.trim() || "Sans titre");
      current = parent.parent_id;
    }
    return parts.reverse().join(" > ");
  };
  const role = (id: string | null | undefined) => (id ? (input.laborRoleNameById.get(id) ?? "") : "");
  const rows: CsvCell[][] = [header];
  for (const item of documentOrder(document.items)) {
    if (item.item_type !== "line") continue;
    const line = prepared.v3.linesById[item.id];
    const priced = line.pricingStatus === "priced";
    const status = ESTIMATE_V3_STATUS_DOCUMENT_LABELS[line.pricingStatus];
    const [supplier1, supplier2, supplier3] = input.supplierLabels(item.id, line.unitCode);
    const split = usesEstimateV3LaborSplit(document, item);
    const hours = (value: number | null | undefined) => (priced ? (value ?? "") : "");
    rows.push([
      sectionPath(item.parent_id),
      prepared.numberingById[item.id] ?? `${item.position}`,
      item.title?.trim() || "Sans titre",
      line.unitCode ?? "",
      item.quantity ?? "",
      status,
      priced ? (euros(item.unit_price_ht_cents) ?? "") : status,
      item.supply_type_id ? (input.supplyTypeById.get(item.supply_type_id) ?? "") : "",
      supplier1,
      supplier2,
      supplier3,
      item.k_fo ?? 1,
      split ? "" : hours(item.h_mo_per_unit),
      priced ? majorationCoefficientToPercent(item.h_mo_majoration ?? 1) : "",
      split ? "" : role(item.labor_role_id),
      split ? "" : (item.k_mo ?? 1),
      priced ? (euros(line.unitSaleHtCents) ?? "") : "",
      priced ? (euros(line.saleHtCents) ?? "") : status,
      rate(line.taxRateBp) ?? "",
      ...(!laborSplit ? [] : split
        ? [hours(item.h_mo_atelier_per_unit), role(item.labor_role_atelier_id), item.k_mo_atelier ?? 1,
          hours(item.h_mo_chantier_per_unit), role(item.labor_role_chantier_id), item.k_mo_chantier ?? 1]
        : ["", "", "", "", "", ""]),
    ]);
  }
  const totalColumn = header.indexOf(`Total HT (${currency})`);
  const footerRow = (label: string, value: CsvCell) =>
    header.map((_, index): CsvCell => (index === 2 ? label : index === totalColumn ? value : ""));
  rows.push([]);
  rows.push(footerRow("Moteur de calcul", 3), footerRow("Montants", amountsSourceLabel(document)));
  for (const [label, amount] of footerEntries(document)) rows.push(footerRow(label, amount));
  if (prepared.v3.totals.reverseCharge) rows.push(footerRow("Régime de TVA", ESTIMATE_VAT_REVERSE_CHARGE_NOTICE));
  return rows;
}

/** Texte CSV : même écriture que le CSV v1/v2 de l'éditeur (`exportToCSV` : SheetJS, séparateur « ; », BOM UTF-8). */
export function writeEstimateV3Csv(rows: CsvCell[][]): string {
  return `﻿${XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(rows), { FS: ";" })}`;
}

/** CSV de l'export standard d'une v3 (GET …/export?format=csv) ; une v1/v2 reçoit un 409 nommé. */
export async function exportEstimateVersionV3Csv(versionId: string) {
  const details = await getEstimateVersionDetails(versionId, { includeExportCalculationContext: true });
  if (!usesSaleCoefficients(resolveEstimateEngineVersion(details.version))) {
    throw conflict(
      "L'export CSV par le serveur est réservé aux devis du moteur de calcul 3 ; l'éditeur construit le CSV d'une version v1/v2.",
      undefined,
      ESTIMATE_CSV_EXPORT_V3_ONLY,
    );
  }
  const document = await loadEstimateV3ExportDocument(versionId);
  const currency = currencyOf(document);
  const lineIds = document.items.filter((item) => item.item_type === "line").map((item) => item.id);
  const comparisons = normalizeSupplierComparisonsByItemId({
    comparisons: await getSupplierComparisonsForExport(versionId, lineIds),
  });
  const rows = buildEstimateV3CsvRows({
    document,
    supplyTypeById: new Map((details.supply_types ?? []).map((supplyType) => [supplyType.id, supplyType.name])),
    laborRoleNameById: new Map((details.labor_roles ?? []).map((laborRole) => [laborRole.id, laborRole.name])),
    supplierLabels: (itemId, unitCode) => {
      const alternatives = comparisons.get(itemId) ?? [];
      return [0, 1, 2].map((rank) => formatSupplierAlternativeCompact(alternatives[rank], currency, unitCode)) as [string, string, string];
    },
  });
  // Nom du CSV de l'éditeur, ramené à l'ASCII : il voyage dans l'en-tête Content-Disposition.
  const filename = buildEstimateExportFilename({
    projectName: details.version.estimate_projects.name,
    versionNumber: details.version.version_number,
  }).normalize("NFD").replaceAll(/[̀-ͯ]/g, "").replaceAll(/[^\x20-\x7e]/g, "_");
  return {
    filename: `${filename}.csv`,
    contentType: ESTIMATE_V3_CSV_CONTENT_TYPE,
    progress: ESTIMATE_EXPORT_PROGRESS_COMPLETE,
    body: writeEstimateV3Csv(rows),
  };
}
