import { COSTING_WORKBOOK_SHEET, type CostingWorkbookSupplierOccurrence } from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookImportInput, CostingWorkbookSupplierReferenceReport } from "@/lib/catalogue/costing-workbook-contract";
import {
  parseWorkbookCellAddress,
  workbookCellAddress,
  workbookCellText,
  workbookEditKey,
  type WorkbookEdit,
  type WorkbookEditEntry,
} from "@/lib/catalogue/costing-workbook-edits";
import { exportToExcelWithSheets, type ExportColumn } from "@/lib/export";
import { foldWords } from "@/lib/text/fold";

export { workbookCellAddress };

export type SupplierDecision = CostingWorkbookSupplierReferenceReport["for_decision"][number];
type Reason = SupplierDecision["reason"];
type Field = "article" | "supplier" | "reference" | "catalogue";

export const WORKBOOK_CORRECTION_RULES: Record<Reason, { label: string; field: Field; advice: string }> = {
  invalid_article_reference: { label: "Identifiant d’article manquant ou invalide", field: "article", advice: "Renseigner un identifiant d’article valide." },
  article_to_create: { label: "Article à créer en brouillon", field: "catalogue", advice: "Importer d’abord les articles en brouillon, puis reprendre les références." },
  article_not_found: { label: "Article actif introuvable", field: "article", advice: "Vérifier l’identifiant et rechercher l’article dans le catalogue." },
  ambiguous_article: { label: "Plusieurs articles correspondent", field: "article", advice: "Identifier la bonne fiche et vérifier son identifiant." },
  invalid_supplier_name: { label: "Nom de fournisseur manquant ou invalide", field: "supplier", advice: "Renseigner le nom du fournisseur tel qu’il figure au catalogue." },
  supplier_not_found: { label: "Fournisseur actif introuvable", field: "supplier", advice: "Vérifier le nom du fournisseur et sa fiche au catalogue." },
  ambiguous_supplier: { label: "Plusieurs fournisseurs correspondent", field: "supplier", advice: "Identifier le bon fournisseur et vérifier son nom." },
  invalid_supplier_sku: { label: "Référence fournisseur illisible ou sans code", field: "reference", advice: "Vérifier le code sur le document fournisseur." },
  price_source_reference: { label: "Source de prix", field: "reference", advice: "Retrouver le code produit sur la source de prix." },
  article_locked: { label: "Droits de modification requis sur cet article", field: "catalogue", advice: "Demander à une personne habilitée de vérifier la fiche article." },
  different_existing_reference: { label: "Une autre référence ou liaison existe déjà", field: "reference", advice: "Comparer le code du classeur à celui du catalogue avant de modifier l’un des deux." },
  withdrawn_reference: { label: "Fournisseur déjà retiré de l’article", field: "catalogue", advice: "Vérifier la liaison retirée dans le catalogue." },
  conflicting_workbook_references: { label: "Plusieurs références dans le classeur pour cet article et ce fournisseur", field: "reference", advice: "Comparer les codes du classeur et vérifier celui du produit." },
};

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

/** Headers the corrections file is read back by: the cell, what it held, what the office wrote instead. */
export const CORRECTION_HEADERS = {
  address: "Cellule à vérifier",
  original: "Valeur d’origine",
  correction: "Correction à renseigner",
} as const;

const COLUMNS: ExportColumn<ExportRow>[] = [
  { key: "reason", header: "Motif" },
  { key: "sheet", header: "Onglet" },
  { key: "address", header: CORRECTION_HEADERS.address },
  { key: "field", header: "Colonne" },
  { key: "value", header: CORRECTION_HEADERS.original, numberFormat: "@" },
  { key: "article", header: "Article" },
  { key: "designation", header: "Désignation" },
  { key: "material", header: "Matière" },
  { key: "dimension", header: "Dimensions" },
  { key: "suppliers", header: "Fournisseur" },
  { key: "codes", header: "Code fournisseur" },
  { key: "sourceCells", header: "Cellule de la référence" },
  { key: "advice", header: "Vérification conseillée" },
  { key: "correction", header: CORRECTION_HEADERS.correction, numberFormat: "@" },
];

export const CORRECTIONS_SHEET = "Corrections";

/** One reason, or every reason of the list when none is given: the office fills one file, in one pass. */
export function exportWorkbookCorrections(reason: Reason | null, decisions: readonly SupplierDecision[], sources: SourceMap) {
  const data = workbookCorrectionRows(reason ? decisions.filter((decision) => decision.reason === reason) : decisions, sources);
  return exportToExcelWithSheets([{ name: CORRECTIONS_SHEET, data, columns: COLUMNS }], {
    filename: reason ? `corrections-${reason.replaceAll("_", "-")}` : "corrections-a-examiner",
  });
}

const JOURNAL_COLUMNS: ExportColumn<WorkbookEditEntry & { sheet: string }>[] = [
  { key: "sheet", header: "Onglet" },
  { key: "address", header: CORRECTION_HEADERS.address },
  { key: "header", header: "Colonne" },
  { key: "before", header: CORRECTION_HEADERS.original, numberFormat: "@" },
  { key: "after", header: CORRECTION_HEADERS.correction, numberFormat: "@" },
];

/**
 * The corrections made in the screen, in the shape of the corrections file: the office copies them into its
 * workbook, or reads the file back at the next import of the same workbook.
 */
export function exportWorkbookEdits(entries: readonly WorkbookEditEntry[]) {
  const data = entries.map((entry) => ({ ...entry, sheet: COSTING_WORKBOOK_SHEET }));
  return exportToExcelWithSheets([{ name: CORRECTIONS_SHEET, data, columns: JOURNAL_COLUMNS }], { filename: "corrections-appliquees" });
}

export type WorkbookCorrectionsRead = {
  edits: WorkbookEdit[];
  /** Filled lines left out, each with the reason the office reads. */
  skipped: Array<{ line: number; address: string; reason: "address" | "changed" }>;
};

export class WorkbookCorrectionsFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookCorrectionsFileError";
  }
}

/**
 * Reads a corrections file back (the export above, filled by the office): each line whose « Correction à
 * renseigner » holds a value corrects its cell. A line is left out when its address is not a cell of the sheet,
 * or when the cell no longer holds the value the file was exported with: the correction was written for another
 * state of the workbook. The values are read as Excel shows them, so « 004205 » keeps its zeros.
 */
export async function readWorkbookCorrectionsFile(
  input: ArrayBuffer,
  rows: CostingWorkbookImportInput["rows"],
): Promise<WorkbookCorrectionsRead> {
  const xlsx = await import("xlsx");
  let lines: unknown[][];
  try {
    const book = xlsx.read(new Uint8Array(input), { type: "array" });
    const name = book.SheetNames.find((sheet) => foldWords(sheet) === foldWords(CORRECTIONS_SHEET)) ?? book.SheetNames[0];
    const sheet = name ? book.Sheets[name] : undefined;
    if (!sheet) throw new Error("no sheet");
    lines = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  } catch {
    throw new WorkbookCorrectionsFileError("Ce fichier n’a pas pu être lu comme un fichier de corrections Excel.");
  }
  const shown = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
  const headerIndex = lines.findIndex((line) => line.some((value) => foldWords(shown(value)) === foldWords(CORRECTION_HEADERS.address)));
  const header = headerIndex < 0 ? [] : lines[headerIndex].map((value) => foldWords(shown(value)));
  const addressColumn = header.indexOf(foldWords(CORRECTION_HEADERS.address));
  const correctionColumn = header.indexOf(foldWords(CORRECTION_HEADERS.correction));
  const originalColumn = header.indexOf(foldWords(CORRECTION_HEADERS.original));
  if (addressColumn < 0 || correctionColumn < 0) {
    throw new WorkbookCorrectionsFileError(
      `Ce fichier n’a pas les colonnes « ${CORRECTION_HEADERS.address} » et « ${CORRECTION_HEADERS.correction} » d’un fichier de corrections.`,
    );
  }

  const edits = new Map<string, WorkbookEdit>();
  const skipped: WorkbookCorrectionsRead["skipped"] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const correction = shown(line[correctionColumn]);
    if (!correction) continue;
    const address = shown(line[addressColumn]);
    const cell = parseWorkbookCellAddress(address);
    if (!cell) {
      skipped.push({ line: index + 1, address, reason: "address" });
      continue;
    }
    if (originalColumn >= 0 && shown(line[originalColumn]) !== workbookCellText(rows, cell.row, cell.column)) {
      skipped.push({ line: index + 1, address, reason: "changed" });
      continue;
    }
    edits.set(workbookEditKey(cell.row, cell.column), { ...cell, value: correction });
  }
  return { edits: [...edits.values()], skipped };
}
