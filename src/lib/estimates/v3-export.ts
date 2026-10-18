import {
  prepareEstimateV3DocumentData,
  type EstimateDocumentV3PreparedData,
  type EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { ESTIMATE_VAT_REVERSE_CHARGE_NOTICE } from "@/lib/estimates/document-copy";
import { MAJORATION_PERCENT_HEADER, majorationCoefficientToPercent } from "@/lib/estimates/majoration";
import {
  buildEstimateV3FooterRows,
  ESTIMATE_V3_STATUS_DOCUMENT_LABELS,
  footerFromStoredV3Document,
} from "@/lib/estimates/v3-document-presentation";
import { loadEstimateV3DocumentSource, type EstimateV3DocumentSource } from "@/lib/estimates/v3-document-server";
import { normalizeEstimateCurrency, type SupportedEstimateCurrency } from "@/lib/money";

/**
 * Lot 2, sous-lot 2.7 - exports XLSX d'une v3 (conception §14 « 2.7 » ; export standard et DPGF) :
 * unité du référentiel, statut, taux de TVA, heures par unité (base des heures dans l'en-tête),
 * PU et PT BRUTS publiés, ligne « Remise commerciale », arrondi commercial, HT net, TVA par taux
 * sur la base nette et TTC, au format de la devise de la version (en-têtes de montant du DPGF compris).
 * Mêmes montants que le document (`prepareEstimateV3DocumentData` sur
 * `loadEstimateV3DocumentSource`) : aucun montant n'est calculé ici. L'accès à la version reste
 * contrôlé par l'appelant (`getEstimateVersionDetails`) avant ce chargement.
 */

type CellValue = string | number | null;

type WorkbookCell = { numFmt?: string; font?: { bold?: boolean; color?: { argb: string } };
  fill?: { type: "pattern"; pattern: "solid"; fgColor: { argb: string } }; alignment?: { horizontal?: "left" | "center" | "right" } };
type WorkbookRow = { commit: () => void; font?: { bold?: boolean }; getCell?: (index: number) => WorkbookCell;
  eachCell?: (callback: (cell: WorkbookCell) => void) => void };
type Worksheet = { columns?: Array<{ header: string; key: string; width?: number }>; addRow: (value: unknown[]) => WorkbookRow;
  getRow?: (index: number) => WorkbookRow; commit: () => void };
type WorkbookWriter = { addWorksheet: (name: string) => Worksheet; commit: () => Promise<void> };
export type EstimateV3WorkbookWriterFactory = (stream: NodeJS.WritableStream) => unknown;

export type EstimateV3ExportDocument = {
  version: EstimateV3DocumentSource["version"];
  items: EstimateItem[];
  prepared: EstimateDocumentV3PreparedData;
  /** Faux pour l'aperçu d'un brouillon modifié depuis son gel. */
  frozen: boolean;
};

export type EstimateV3ExportIdentity = {
  projectName: string;
  projectReference: string | null;
  projectClient?: string | null;
  projectAuthor?: string;
  versionNumber: number;
  versionTitle: string | null;
  versionStatus: string;
  dateDevis: string;
};

/** Format Excel des montants par devise : symbole et place de `formatCurrency` (money.ts) ; EUR inchangé. */
export const ESTIMATE_V3_CURRENCY_FORMATS: Readonly<Record<SupportedEstimateCurrency, string>> = {
  EUR: "#,##0.00 \"€\"",
  USD: "\"$\"#,##0.00",
  GBP: "\"£\"#,##0.00",
};

export async function loadEstimateV3ExportDocument(versionId: string): Promise<EstimateV3ExportDocument> {
  const context = await getAuthenticatedTenantContext();
  const source = await loadEstimateV3DocumentSource({ supabase: context.supabase, tenantId: context.tenantId, versionId });
  const prepared = prepareEstimateV3DocumentData({
    calcEngineVersion: 3, items: source.items, version: source.version,
    currency: source.version.currency, validiteJours: source.version.validite_jours,
  });
  return { version: source.version, items: source.items, prepared, frozen: source.frozen };
}

export function euros(cents: number | null | undefined): number | null {
  return Number.isFinite(cents ?? NaN) ? (cents as number) / 100 : null;
}

export function rate(bp: number | null | undefined): number | null {
  return Number.isFinite(bp ?? NaN) ? (bp as number) / 100 : null;
}

function styleHeader(sheet: Worksheet) {
  const header = sheet.getRow?.(1);
  if (!header) return;
  header.eachCell?.((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    cell.alignment = { horizontal: "left" };
  });
  header.commit();
}

/** Devise de la version (repli EUR, comme le document). */
export function currencyOf(document: EstimateV3ExportDocument): SupportedEstimateCurrency {
  return normalizeEstimateCurrency(document.version.currency) ?? "EUR";
}

/** Ajout de lignes à une feuille ; `currency` liste les colonnes (base 1) au format monétaire de la version. */
function rowWriter(sheet: Worksheet, currency: SupportedEstimateCurrency) {
  return (values: CellValue[], options: { currency?: number[]; bold?: boolean } = {}) => {
    const row = sheet.addRow(values);
    if (options.bold) row.font = { bold: true };
    for (const index of options.currency ?? []) {
      const cell = row.getCell?.(index);
      if (cell) cell.numFmt = ESTIMATE_V3_CURRENCY_FORMATS[currency];
    }
    row.commit();
  };
}

/** Source des montants exportés : gel du devis, ou aperçu d'un brouillon modifié depuis son gel (jamais présenté figé). */
export function amountsSourceLabel(document: EstimateV3ExportDocument): string {
  return document.frozen ? "Gel du devis" : "Aperçu du brouillon (non figé)";
}

/** Lignes du pied v3 (libellé, montant signé dans la devise de la version) : mêmes libellés que le document. */
export function footerEntries(document: EstimateV3ExportDocument): Array<[string, number]> {
  return buildEstimateV3FooterRows(footerFromStoredV3Document(document.prepared.v3.totals), currencyOf(document))
    .map((row) => [row.label, (row.deduction ? -row.cents : row.cents) / 100]);
}

export function depthsOf(items: EstimateItem[]): Map<string, number> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const depths = new Map<string, number>();
  for (const item of items) {
    let depth = 0;
    let parentId = item.parent_id;
    while (parentId !== null && depth <= items.length) {
      depth += 1;
      parentId = byId.get(parentId)?.parent_id ?? null;
    }
    depths.set(item.id, depth);
  }
  return depths;
}

/** Ordre du document : arbre par position (même parcours que le préparateur). */
export function documentOrder(items: EstimateItem[]): EstimateItem[] {
  const children = new Map<string | null, EstimateItem[]>();
  for (const item of items) {
    const siblings = children.get(item.parent_id) ?? [];
    siblings.push(item);
    children.set(item.parent_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.position - right.position);
  const ordered: EstimateItem[] = [];
  const visit = (parentId: string | null) => {
    for (const item of children.get(parentId) ?? []) {
      ordered.push(item);
      if (item.item_type === "section") visit(item.id);
    }
  };
  visit(null);
  return ordered;
}

/** Export standard (« Devis » et « Resume ») d'une v3. */
export async function writeEstimateV3Workbook(input: {
  identity: EstimateV3ExportIdentity & { versionId: string };
  document: EstimateV3ExportDocument;
  stream: NodeJS.WritableStream;
  workbookWriterFactory: EstimateV3WorkbookWriterFactory;
}) {
  const workbook = (await input.workbookWriterFactory(input.stream)) as WorkbookWriter;
  const { prepared, version } = input.document;
  const reverseCharge = prepared.v3.totals.reverseCharge;
  const currency = currencyOf(input.document);
  const sheet = workbook.addWorksheet("Devis");
  const addRow = rowWriter(sheet, currency);
  sheet.columns = [
    { header: "Poste", key: "poste", width: 12 },
    { header: "Désignation", key: "designation", width: 44 },
    { header: "Unité", key: "unite", width: 10 },
    { header: "Quantité", key: "quantite", width: 12 },
    { header: "Statut", key: "statut", width: 16 },
    { header: "TVA (%)", key: "tva", width: 10 },
    { header: "PU HT", key: "pu_ht", width: 14 },
    { header: "Total HT", key: "total_ht", width: 16 },
  ];
  styleHeader(sheet);
  for (const item of documentOrder(input.document.items)) {
    const poste = prepared.numberingById[item.id] ?? `${item.position}`;
    if (item.item_type === "section") {
      addRow([poste, item.title, null, null, null, null, null, euros(prepared.sectionTotalsById[item.id]?.totalHtCents)],
        { bold: true, currency: [8] });
      continue;
    }
    const line = prepared.v3.linesById[item.id];
    const priced = line.pricingStatus === "priced";
    const status = ESTIMATE_V3_STATUS_DOCUMENT_LABELS[line.pricingStatus];
    // Comme le document : une ligne non chiffrée porte son statut au lieu d'un montant (aucun « Total HT » 0 que
    // l'import DPGF lirait comme total_ht).
    addRow([poste, item.title, line.unitLabel ?? "", item.quantity ?? 0, status,
      rate(line.taxRateBp), priced ? euros(line.unitSaleHtCents) : null, priced ? euros(line.saleHtCents) : status],
      { currency: priced ? [7, 8] : [] });
  }
  addRow([]);
  for (const [label, amount] of footerEntries(input.document)) {
    addRow([null, label, null, null, null, null, null, amount], { bold: label === "Total HT net", currency: [8] });
  }
  sheet.commit();

  const summary = workbook.addWorksheet("Resume");
  summary.columns = [{ header: "Champ", key: "field", width: 40 }, { header: "Valeur", key: "value", width: 32 }];
  styleHeader(summary);
  const addSummaryRow = rowWriter(summary, currency);
  const rows: Array<[string, string | number]> = [
    ["Version ID", input.identity.versionId],
    ["Projet", input.identity.projectName],
    ["Référence", input.identity.projectReference ?? ""],
    ["Version", input.identity.versionNumber],
    ["Titre", input.identity.versionTitle ?? ""],
    ["Statut", input.identity.versionStatus],
    ["Moteur de calcul", 3],
    ["Montants", amountsSourceLabel(input.document)],
    ["Coefficient de vente FO", Number(version.sale_coefficient_fo ?? 0)],
    ["Coefficient de vente MO", Number(version.sale_coefficient_mo ?? 0)],
    ...footerEntries(input.document),
    ...(reverseCharge ? [["Régime de TVA", ESTIMATE_VAT_REVERSE_CHARGE_NOTICE] as [string, string]] : []),
  ];
  const currencyFields = new Set(footerEntries(input.document).map(([label]) => label));
  for (const [field, value] of rows) addSummaryRow([field, value], { currency: currencyFields.has(field) ? [2] : [] });
  summary.commit();
  await workbook.commit();
}

/**
 * Export DPGF (« Données » et « Metadata ») d'une v3 : saisies réimportables, plus PU et PT bruts. Une ligne non
 * chiffrée (incluse, pour mémoire, hors lot…) n'écrit aucun nombre que l'import DPGF lit comme prix, déboursé ou
 * main-d'oeuvre (profil `dpgf_export` et heuristique de correspondance : PR FO, total, heures, majoration) : réimportée,
 * elle ne peut pas redevenir facturable. Ses cellules de prix portent le libellé de son statut, comme le document.
 */
export async function writeEstimateV3DpgfWorkbook(input: {
  identity: EstimateV3ExportIdentity;
  document: EstimateV3ExportDocument;
  supplyTypeById: ReadonlyMap<string, string>;
  laborRoleNameById: ReadonlyMap<string, string>;
  categoryById: ReadonlyMap<string, string>;
  stream: NodeJS.WritableStream;
  workbookWriterFactory: EstimateV3WorkbookWriterFactory;
}) {
  const workbook = (await input.workbookWriterFactory(input.stream)) as WorkbookWriter;
  const { prepared, version } = input.document;
  const role = (id: string | null | undefined) => (id ? (input.laborRoleNameById.get(id) ?? "") : "");
  const currency = currencyOf(input.document);
  const sheet = workbook.addWorksheet("Données");
  const addRow = rowWriter(sheet, currency);
  sheet.columns = [
    { header: "Type", key: "type", width: 12 },
    { header: "AID", key: "aid", width: 22 },
    { header: "Désignation", key: "designation", width: 44 },
    { header: "Quantité", key: "quantite", width: 12 },
    { header: "Unité", key: "unite", width: 10 },
    { header: "Statut", key: "statut", width: 16 },
    { header: "TVA (%)", key: "tva", width: 10 },
    { header: `Prix unitaire HT ${currency}`, key: "prix_unitaire_ht_eur", width: 22 },
    { header: "Type FO", key: "type_fo", width: 18 },
    { header: "K FO", key: "k_fo", width: 10 },
    { header: "h MO / unité", key: "h_mo_per_unit", width: 14 },
    { header: "K MO", key: "k_mo", width: 10 },
    { header: MAJORATION_PERCENT_HEADER, key: "majoration_mo", width: 18 },
    { header: "Rôle MO", key: "role_mo", width: 24 },
    { header: "Catégorie", key: "categorie", width: 24 },
    { header: "h MO Atelier / unité", key: "h_mo_atelier_per_unit", width: 20 },
    { header: "K MO Atelier", key: "k_mo_atelier", width: 14 },
    { header: "Rôle MO Atelier", key: "role_mo_atelier", width: 24 },
    { header: "h MO Chantier / unité", key: "h_mo_chantier_per_unit", width: 21 },
    { header: "K MO Chantier", key: "k_mo_chantier", width: 15 },
    { header: "Rôle MO Chantier", key: "role_mo_chantier", width: 24 },
    { header: `PU vente HT ${currency}`, key: "pu_vente_ht_eur", width: 18 },
    { header: `Total HT brut ${currency}`, key: "total_ht_brut_eur", width: 18 },
  ];
  styleHeader(sheet);
  const depths = depthsOf(input.document.items);
  for (const item of documentOrder(input.document.items)) {
    const designation = `${"  ".repeat(depths.get(item.id) ?? 0)}${item.title}`;
    const aid = (item as EstimateItem & { aid?: string | null }).aid?.trim() || item.id;
    if (item.item_type === "section") {
      addRow(["section", aid, designation], { bold: true });
      continue;
    }
    const line = prepared.v3.linesById[item.id];
    const priced = line.pricingStatus === "priced";
    const status = ESTIMATE_V3_STATUS_DOCUMENT_LABELS[line.pricingStatus];
    const hours = (value: number | null | undefined) => (priced ? (value ?? null) : null);
    addRow([
      "line", aid, designation, item.quantity ?? null, line.unitCode ?? "", status,
      rate(line.taxRateBp), priced ? euros(item.unit_price_ht_cents) : status,
      item.supply_type_id ? (input.supplyTypeById.get(item.supply_type_id) ?? "") : "", item.k_fo ?? 1,
      hours(item.h_mo_per_unit), item.k_mo ?? 1, priced ? majorationCoefficientToPercent(item.h_mo_majoration ?? 1) : null,
      role(item.labor_role_id), item.category_id ? (input.categoryById.get(item.category_id) ?? "") : "",
      hours(item.h_mo_atelier_per_unit), item.k_mo_atelier ?? null, role(item.labor_role_atelier_id),
      hours(item.h_mo_chantier_per_unit), item.k_mo_chantier ?? null, role(item.labor_role_chantier_id),
      priced ? euros(line.unitSaleHtCents) : null, priced ? euros(line.saleHtCents) : status,
    ], { currency: priced ? [8, 22, 23] : [] });
  }
  sheet.commit();

  const metadata = workbook.addWorksheet("Metadata");
  metadata.columns = [{ header: "Champ", key: "champ", width: 40 }, { header: "Valeur", key: "valeur", width: 42 }];
  styleHeader(metadata);
  const addMetadataRow = rowWriter(metadata, currency);
  const totals = footerEntries(input.document);
  const rows: Array<[string, string | number]> = [
    ["Référence", input.identity.projectReference ?? ""],
    ["Client", input.identity.projectClient ?? ""],
    ["Date", input.identity.dateDevis],
    ["Version", input.identity.versionTitle?.trim()
      ? `v${input.identity.versionNumber} - ${input.identity.versionTitle.trim()}` : `v${input.identity.versionNumber}`],
    ["Auteur", input.identity.projectAuthor ?? ""],
    ["Moteur de calcul", 3],
    ["Coefficient de vente FO", Number(version.sale_coefficient_fo ?? 0)],
    ["Coefficient de vente MO", Number(version.sale_coefficient_mo ?? 0)],
    ...totals,
    ...(prepared.v3.totals.reverseCharge ? [["Régime de TVA", ESTIMATE_VAT_REVERSE_CHARGE_NOTICE] as [string, string]] : []),
  ];
  const currencyFields = new Set(totals.map(([label]) => label));
  for (const [field, value] of rows) addMetadataRow([field, value], { currency: currencyFields.has(field) ? [2] : [] });
  metadata.commit();
  await workbook.commit();
}
