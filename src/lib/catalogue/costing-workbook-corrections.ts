import {
  COSTING_WORKBOOK_SHEET,
  inspectCostingWorkbookColumns,
  workbookReferenceKey,
  type CostingWorkbookSupplierOccurrence,
} from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookImportInput, CostingWorkbookSupplierReferenceReport } from "@/lib/catalogue/costing-workbook-contract";
import {
  parseWorkbookCellAddress,
  workbookCellAddress,
  workbookCellText,
  workbookEditKey,
  type WorkbookEdit,
  type WorkbookEditEntry,
} from "@/lib/catalogue/costing-workbook-edits";
import { applyWorkbookFileEdits, COSTING_WORKBOOK_MAX_FILE_BYTES } from "@/lib/catalogue/costing-workbook-file";
import { exportToExcelWithSheets, type ExportColumn } from "@/lib/export";
import { foldText, foldWords } from "@/lib/text/fold";

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
type Rows = CostingWorkbookImportInput["rows"];

function workbookArticleIdentity(rows: Rows, mapped: Rows = rows) {
  const { headerRow, found } = inspectCostingWorkbookColumns(mapped);
  const column = found.find((field) => field.column === "ID")?.index;
  const counts = new Map<string, number>();
  if (column !== undefined && headerRow !== null) {
    for (let row = headerRow + 1; row <= rows.length; row += 1) {
      const key = workbookReferenceKey(workbookCellText(rows, row, column));
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return { headerRow, found, column, counts };
}

function exportedArticleUniqueness(article: string, counts: ReadonlyMap<string, number>) {
  const count = counts.get(workbookReferenceKey(article));
  return count === undefined ? "" : count === 1 ? "Oui" : "Non";
}

export function workbookCorrectionRows(decisions: readonly SupplierDecision[], sources: SourceMap, rows: Rows, mapped: Rows = rows) {
  const identity = workbookArticleIdentity(rows, mapped);
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
    const article = source?.article_reference ?? "";
    // The report sees edits and filters, but only the full original workbook can attest an ID.
    const originalArticle = source && identity.column !== undefined ? workbookCellText(rows, source.row, identity.column) : "";
    return {
      sheet: COSTING_WORKBOOK_SHEET,
      address,
      field: correction.field,
      value: correction.value,
      article,
      sourceArticleUnique: originalArticle === article ? exportedArticleUniqueness(article, identity.counts) : "",
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
  field: "Colonne",
  article: "Article",
  clear: "Effacer la cellule",
  header: "Ligne d’en-tête",
  sourceArticleUnique: "Identifiant unique à l’export",
} as const;

const COLUMNS: ExportColumn<ExportRow>[] = [
  { key: "reason", header: "Motif" },
  { key: "sheet", header: "Onglet" },
  { key: "address", header: CORRECTION_HEADERS.address },
  { key: "field", header: CORRECTION_HEADERS.field },
  { key: "value", header: CORRECTION_HEADERS.original, numberFormat: "@" },
  { key: "article", header: CORRECTION_HEADERS.article },
  { key: "sourceArticleUnique", header: CORRECTION_HEADERS.sourceArticleUnique },
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
export function exportWorkbookCorrections(
  reason: Reason | null, decisions: readonly SupplierDecision[], sources: SourceMap, rows: Rows, mapped: Rows = rows,
) {
  const data = workbookCorrectionRows(reason ? decisions.filter((decision) => decision.reason === reason) : decisions, sources, rows, mapped);
  return exportToExcelWithSheets([{ name: CORRECTIONS_SHEET, data, columns: COLUMNS }], {
    filename: reason ? `corrections-${reason.replaceAll("_", "-")}` : "corrections-a-examiner",
  });
}

type JournalRow = WorkbookEditEntry & { sheet: string; article: string; clear: string; headerLine: string; sourceArticleUnique: string };

const JOURNAL_COLUMNS: ExportColumn<JournalRow>[] = [
  { key: "sheet", header: "Onglet" },
  { key: "address", header: CORRECTION_HEADERS.address },
  { key: "header", header: CORRECTION_HEADERS.field },
  { key: "before", header: CORRECTION_HEADERS.original, numberFormat: "@" },
  { key: "after", header: CORRECTION_HEADERS.correction, numberFormat: "@" },
  { key: "article", header: CORRECTION_HEADERS.article, numberFormat: "@" },
  { key: "sourceArticleUnique", header: CORRECTION_HEADERS.sourceArticleUnique },
  { key: "clear", header: CORRECTION_HEADERS.clear },
  { key: "headerLine", header: CORRECTION_HEADERS.header },
];

/**
 * The corrections made in the screen, in the shape of the corrections file: the office copies them into its
 * workbook, or reads the file back at the next import of the same workbook.
 */
export function workbookJournalRows(entries: readonly WorkbookEditEntry[], rows: Rows, mapped: Rows = rows): JournalRow[] {
  const { headerRow, column, counts } = workbookArticleIdentity(rows, mapped);
  return entries.map((entry) => {
    const headerLine = entry.row === headerRow;
    const article = column === undefined || headerLine ? "" : workbookCellText(rows, entry.row, column);
    return {
      ...entry,
      sheet: COSTING_WORKBOOK_SHEET,
      header: headerLine ? entry.before : entry.header,
      article,
      sourceArticleUnique: exportedArticleUniqueness(article, counts),
      clear: entry.after === "" ? "Oui" : "",
      headerLine: headerLine ? "Oui" : "",
    };
  });
}

export function exportWorkbookEdits(entries: readonly WorkbookEditEntry[], rows: Rows, mapped: Rows) {
  return exportToExcelWithSheets(
    [{ name: CORRECTIONS_SHEET, data: workbookJournalRows(entries, rows, mapped), columns: JOURNAL_COLUMNS }],
    { filename: "corrections-appliquees" },
  );
}

type CorrectionLine = {
  line: number;
  address: string;
  original: string;
  field: string;
  article: string;
  headerLine: boolean;
  sourceArticleUnique: boolean;
  value: string | null;
};
type SkipReason = "address" | "changed" | "article" | "field" | "source_article";

export type WorkbookCorrectionsRead = {
  edits: WorkbookEdit[];
  skipped: Array<{ line: number; address: string; reason: SkipReason }>;
};

const fieldKey = (value: string) => foldText(value).replace(/\s+/g, " ").trim();

function verifiedCorrections(lines: readonly CorrectionLine[], rows: Rows): WorkbookCorrectionsRead {
  const edits = new Map<string, WorkbookEdit>();
  const skipped: WorkbookCorrectionsRead["skipped"] = [];
  const initialHeader = inspectCostingWorkbookColumns(rows).headerRow;
  function verify(line: CorrectionLine, sheet: Rows, headerRow: number | null, identity?: {
    column: number;
    counts: Map<string, number>;
    fields: Map<number, string>;
  }) {
    const cell = parseWorkbookCellAddress(line.address);
    let reason: SkipReason | undefined;
    if (!cell || cell.row > sheet.length || headerRow === null || cell.row < headerRow) reason = "address";
    else if (line.headerLine !== (cell.row === headerRow)) reason = "field";
    else if (!line.headerLine && (!identity || !line.article || identity.counts.get(workbookReferenceKey(line.article)) !== 1
      || workbookCellText(sheet, cell.row, identity.column) !== line.article)) reason = "article";
    else if (!line.field || fieldKey(line.field) !== fieldKey(
      line.headerLine ? workbookCellText(sheet, headerRow, cell.column) : identity?.fields.get(cell.column) ?? "",
    )) reason = "field";
    else if (line.original !== workbookCellText(sheet, cell.row, cell.column)) reason = "changed";
    else if (!line.headerLine && !line.sourceArticleUnique) reason = "source_article";
    if (reason) skipped.push({ line: line.line, address: line.address, reason });
    else if (cell) edits.set(workbookEditKey(cell.row, cell.column), { ...cell, value: line.value });
  }
  for (const line of lines) if (line.headerLine) verify(line, rows, initialHeader);
  const mapped = edits.size ? applyWorkbookFileEdits(rows, [...edits.values()]) : rows;
  const { headerRow, found, column, counts } = workbookArticleIdentity(mapped);
  const fields = new Map<number, string>(found.map(({ column: field, index }) => [index, field]));
  const identity = column === undefined ? undefined : { column, counts, fields };
  for (const line of lines) if (!line.headerLine) verify(line, mapped, headerRow, identity);
  return { edits: [...edits.values()], skipped: skipped.sort((a, b) => a.line - b.line) };
}

export type RejectedWorkbookEdit = WorkbookCorrectionsRead["skipped"][number] & {
  value: string | null;
};

export const SKIPPED_CORRECTION_LABELS: Record<SkipReason, string> = {
  changed: "la valeur d’origine a changé",
  address: "l’adresse ne désigne pas une cellule de l’onglet",
  article: "l’article de la ligne n’a pas pu être vérifié",
  field: "le champ de la cellule a changé",
  source_article: "l’unicité de l’identifiant dans le classeur d’origine n’est pas attestée. Vérifiez la ligne dans le classeur d’origine avant de reporter la correction",
};

export function reapplyWorkbookJournal(entries: readonly JournalRow[], rows: Rows) {
  const lines = entries.map((entry, index) => ({
    ...entry, line: index + 2, original: entry.before, field: entry.header,
    headerLine: entry.headerLine === "Oui", sourceArticleUnique: entry.sourceArticleUnique === "Oui",
    value: entry.clear === "Oui" ? null : entry.after,
  }));
  const replay = verifiedCorrections(lines, rows);
  return {
    edits: replay.edits,
    skipped: replay.skipped.map((entry): RejectedWorkbookEdit => ({ ...entry, value: lines[entry.line - 2].value })),
  };
}

export function exportRejectedWorkbookEdits(entries: readonly RejectedWorkbookEdit[]) {
  const data = entries.map(({ address, value, reason }) => ({
    address, value: value ?? "Effacer la cellule", reason: SKIPPED_CORRECTION_LABELS[reason],
  }));
  return exportToExcelWithSheets([{
    name: "Corrections écartées", data,
    columns: [
      { key: "address", header: "Cellule" },
      { key: "value", header: "Correction saisie", numberFormat: "@" },
      { key: "reason", header: "Motif" },
    ],
  }], { filename: "corrections-ecartees" });
}

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
 * state of the workbook. Article rows also need proof that the ID was unique in both sheets. Older exports
 * cannot supply this proof but still support explicit header corrections. Excel text keeps its leading zeros.
 */
export async function readWorkbookCorrectionsFile(
  input: ArrayBuffer,
  rows: CostingWorkbookImportInput["rows"],
): Promise<WorkbookCorrectionsRead> {
  if (input.byteLength > COSTING_WORKBOOK_MAX_FILE_BYTES) {
    throw new WorkbookCorrectionsFileError("Ce fichier de corrections dépasse 20 Mo.");
  }
  const xlsx = await import("xlsx");
  const lines = new Map<number, Map<number, string>>();
  try {
    const bytes = new Uint8Array(input);
    const names = xlsx.read(bytes, { type: "array", bookSheets: true }).SheetNames;
    const name = names.find((sheet) => foldWords(sheet) === foldWords(CORRECTIONS_SHEET)) ?? names[0];
    const sheet = name ? xlsx.read(bytes, { type: "array", sheets: name }).Sheets[name] : undefined;
    if (!sheet) throw new Error("no sheet");
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = sheet[address] as import("xlsx").CellObject;
      if (cell.v === undefined || cell.v === null) continue;
      const { r, c } = xlsx.utils.decode_cell(address);
      const value = xlsx.utils.format_cell(cell).trim();
      if (!value) continue;
      const line = lines.get(r) ?? new Map<number, string>();
      line.set(c, value);
      lines.set(r, line);
    }
  } catch {
    throw new WorkbookCorrectionsFileError("Ce fichier n’a pas pu être lu comme un fichier de corrections Excel.");
  }

  const headers = Object.values(CORRECTION_HEADERS);
  const ordered = [...lines].sort(([left], [right]) => left - right);
  const header = ordered.find(([, line]) => [...line.values()].some((value) => foldWords(value) === foldWords(CORRECTION_HEADERS.address)));
  const columns = new Map([...(header?.[1] ?? [])].map(([column, value]) => [foldWords(value), column]));
  const [
    addressColumn, originalColumn, correctionColumn, fieldColumn, articleColumn, clearColumn, headerColumn, sourceArticleUniqueColumn,
  ] = headers.map((name) => columns.get(foldWords(name)) ?? -1);
  if (!header || [addressColumn, originalColumn, correctionColumn, fieldColumn, articleColumn].some((column) => column < 0)) {
    throw new WorkbookCorrectionsFileError(
      "Ce fichier doit contenir les colonnes « Cellule à vérifier », « Valeur d’origine », « Correction à renseigner », « Colonne » et « Article ».",
    );
  }

  const corrections = ordered.flatMap(([r, line]) => {
    if (r <= header[0]) return [];
    const clear = foldWords(line.get(clearColumn) ?? "") === "oui";
    const correction = line.get(correctionColumn);
    if (!clear && !correction) return [];
    return [{
      line: r + 1,
      address: line.get(addressColumn) ?? "",
      original: line.get(originalColumn) ?? "",
      field: line.get(fieldColumn) ?? "",
      article: line.get(articleColumn) ?? "",
      headerLine: foldWords(line.get(headerColumn) ?? "") === "oui",
      sourceArticleUnique: foldWords(line.get(sourceArticleUniqueColumn) ?? "") === "oui",
      value: clear ? null : correction!,
    }];
  });
  return verifiedCorrections(corrections, rows);
}
