import { COSTING_WORKBOOK_SHEET, type CostingWorkbookSupplierOccurrence } from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookSupplierReferenceReport } from "@/lib/catalogue/costing-workbook-contract";
import { exportToExcelWithSheets, type ExportColumn } from "@/lib/export";

export type SupplierDecision = CostingWorkbookSupplierReferenceReport["for_decision"][number];
type Reason = SupplierDecision["reason"];
type Field = "article" | "supplier" | "reference" | "catalogue";

export const WORKBOOK_CORRECTION_RULES: Record<Reason, { label: string; field: Field; advice: string }> = {
  invalid_article_reference: { label: "Identifiant d’article manquant ou invalide", field: "article", advice: "Renseigner un identifiant d’article valide." },
  article_not_found: { label: "Article actif introuvable", field: "article", advice: "Vérifier l’identifiant et rechercher l’article dans le catalogue." },
  ambiguous_article: { label: "Plusieurs articles correspondent", field: "article", advice: "Identifier la bonne fiche et vérifier son identifiant." },
  invalid_supplier_name: { label: "Nom de fournisseur manquant ou invalide", field: "supplier", advice: "Renseigner le nom du fournisseur tel qu’il figure au catalogue." },
  supplier_not_found: { label: "Fournisseur actif introuvable", field: "supplier", advice: "Vérifier le nom du fournisseur et sa fiche au catalogue." },
  ambiguous_supplier: { label: "Plusieurs fournisseurs correspondent", field: "supplier", advice: "Identifier le bon fournisseur et vérifier son nom." },
  invalid_supplier_sku: { label: "Référence fournisseur illisible ou trop longue", field: "reference", advice: "Vérifier le code sur le document fournisseur." },
  price_source_reference: { label: "Source de prix", field: "reference", advice: "Retrouver le code produit sur la source de prix." },
  article_locked: { label: "Droits de modification requis sur cet article", field: "catalogue", advice: "Demander à une personne habilitée de vérifier la fiche article." },
  different_existing_reference: { label: "Une autre référence ou liaison existe déjà", field: "reference", advice: "Comparer le code du classeur à celui du catalogue avant de modifier l’un des deux." },
  withdrawn_reference: { label: "Fournisseur déjà retiré de l’article", field: "catalogue", advice: "Vérifier la liaison retirée dans le catalogue." },
  conflicting_workbook_references: { label: "Plusieurs références dans le classeur pour cet article et ce fournisseur", field: "reference", advice: "Comparer les codes du classeur et vérifier celui du produit." },
};

export function workbookCellAddress(row: number, column: number) {
  let letters = "";
  for (let value = column + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
  }
  return letters + row;
}

export function workbookCorrection(decision: SupplierDecision, source?: CostingWorkbookSupplierOccurrence) {
  const { field, advice } = WORKBOOK_CORRECTION_RULES[decision.reason];
  const { slot } = decision;
  switch (field) {
    case "article":
      return { field: "ID", column: source?.article_column, value: source?.article_reference ?? "", advice };
    case "supplier": {
      const fieldName = `F${slot}_nom`;
      const column = source?.supplier_name_column;
      return {
        field: fieldName, column, value: source?.supplier_name ?? "",
        advice: source && column === undefined ? `Ajouter la colonne ${fieldName} au classeur et renseigner le fournisseur.` : advice,
      };
    }
    case "reference":
      return { field: `F${slot}_ref`, column: source?.column, value: source?.supplier_sku ?? "", advice };
    case "catalogue":
      return { field: "Catalogue", column: undefined, value: "", advice };
  }
}

type SourceMap = ReadonlyMap<string, CostingWorkbookSupplierOccurrence>;

export function workbookCorrectionRows(decisions: readonly SupplierDecision[], sources: SourceMap) {
  const groups = new Map<string, {
    address: string;
    reason: Reason;
    correction: ReturnType<typeof workbookCorrection>;
    occurrences: CostingWorkbookSupplierOccurrence[];
  }>();
  for (const decision of decisions) {
    const { row, slot, reason } = decision;
    const key = `${row}-${slot}`;
    const source = sources.get(key);
    const correction = workbookCorrection(decision, source);
    const address = correction.column === undefined ? "" : workbookCellAddress(row, correction.column);
    // One task per physical cell and reason. Catalogue actions and missing columns keep each source distinct.
    const groupKey = `${reason}:${address || key}`;
    const group = groups.get(groupKey);
    if (group) {
      if (source) group.occurrences.push(source);
      continue;
    }
    groups.set(groupKey, { address, reason, correction, occurrences: source ? [source] : [] });
  }

  return Array.from(groups.values(), ({ address, reason, correction, occurrences }) => {
    const [source] = occurrences;
    return {
      sheet: COSTING_WORKBOOK_SHEET,
      address,
      field: correction.field,
      value: correction.value,
      article: source?.article_reference ?? "",
      designation: source?.article_wording ?? "",
      material: source?.article_material ?? "",
      dimension: source?.article_dimension ?? "",
      suppliers: occurrences.map(({ supplier_name }) => supplier_name).join("\n"),
      codes: occurrences.map(({ supplier_sku }) => supplier_sku).join("\n"),
      sourceCells: occurrences.map(({ row, column }) => workbookCellAddress(row, column)).join("\n"),
      reason: WORKBOOK_CORRECTION_RULES[reason].label,
      advice: correction.advice,
      correction: "",
    };
  });
}

type ExportRow = ReturnType<typeof workbookCorrectionRows>[number];

const COLUMNS: ExportColumn<ExportRow>[] = [
  { key: "reason", header: "Motif" },
  { key: "sheet", header: "Onglet" },
  { key: "address", header: "Cellule à vérifier" },
  { key: "field", header: "Colonne" },
  { key: "value", header: "Valeur d’origine" },
  { key: "article", header: "Article" },
  { key: "designation", header: "Désignation" },
  { key: "material", header: "Matière" },
  { key: "dimension", header: "Dimensions" },
  { key: "suppliers", header: "Fournisseur" },
  { key: "codes", header: "Code fournisseur" },
  { key: "sourceCells", header: "Cellule de la référence" },
  { key: "advice", header: "Vérification conseillée" },
  { key: "correction", header: "Correction à renseigner", numberFormat: "@" },
];

export function exportWorkbookCorrections(reason: Reason, decisions: readonly SupplierDecision[], sources: SourceMap) {
  const data = workbookCorrectionRows(decisions.filter((decision) => decision.reason === reason), sources);
  return exportToExcelWithSheets([{ name: "Corrections", data, columns: COLUMNS }], {
    filename: `corrections-${reason.replaceAll("_", "-")}`,
  });
}
