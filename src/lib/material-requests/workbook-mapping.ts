import { foldWords } from "@/lib/text/fold";

/**
 * What a column of a needs list can stand for, and the rules a workbook row follows on its way to a draft line
 * (owner's decision of 2026-11-27). Pure: the server reads the workbook with it, the browser maps and remembers
 * columns with it.
 */

export const WORKBOOK_ROLES = ["designation", "dimension", "quantity", "unit", "supplier", "reference", "material", "zone"] as const;
export type WorkbookRole = (typeof WORKBOOK_ROLES)[number];
/** Column letters (« A », « AB ») by role; a role left out is not read. */
export type WorkbookMapping = Partial<Record<WorkbookRole, string>>;

export const WORKBOOK_ROLE_LABELS: Record<WorkbookRole, string> = {
  designation: "Désignation",
  dimension: "Dimension",
  quantity: "Quantité",
  unit: "Unité",
  supplier: "Fournisseur",
  reference: "Référence",
  material: "Matière",
  zone: "Repère",
};

/** Synonyms by role, best first: when two columns could serve a role, the better synonym wins, then the leftmost. */
const SYNONYMS: Record<WorkbookRole, readonly string[]> = {
  designation: ["designation", "designation article", "article", "libelle", "description", "materiel", "produit"],
  quantity: ["quantite", "qte", "qty", "quantity", "besoin retenu", "quantite retenue", "quantite a consulter", "quantite demandee", "besoin"],
  unit: ["unite", "unite de mesure", "u", "unit"],
  dimension: ["dimension", "dimensions", "dimension embouts", "dimension raccordement", "diametre", "dn", "dn dim", "dim"],
  reference: [
    "reference", "ref", "reference fournisseur", "ref fournisseur", "reference article", "ref article", "code article",
  ],
  supplier: ["fournisseur", "fournisseur retenu", "fournisseur a consulter", "supplier"],
  // « Famille » is not a material (owner, 2026-11-27): the user may still assign that column to the material by hand.
  material: ["matiere", "materiau", "material"],
  zone: ["zone", "repere", "localisation", "emplacement"],
};

const rankByLabel = new Map<string, Array<{ role: WorkbookRole; rank: number }>>();
for (const role of WORKBOOK_ROLES) {
  SYNONYMS[role].forEach((label, rank) => {
    const entries = rankByLabel.get(label) ?? [];
    entries.push({ role, rank });
    rankByLabel.set(label, entries);
  });
}

/** Footnote marks: superscript digits and letters, daggers, asterisks, and a bracketed number such as « (1) » or « [2] ». */
const FOOTNOTES = /[¹²³⁰-₟†‡*]+|[([]\s*\d{1,2}\s*[)\]]/gu;

/** The header as recognition compares it: footnote marks and punctuation removed, then folded. */
export function normalizeWorkbookHeader(text: string): string {
  return foldWords(text.replace(FOOTNOTES, " "));
}

/**
 * The roles a header could serve, with how well (0 is best). The whole header is tried first, so « Quantité (à
 * consulter) » ranks as « quantité à consulter »; a trailing aside in brackets is dropped only when the whole header
 * is not a synonym (« Quantité (u) »).
 */
function headerRoles(text: string) {
  const withoutNotes = text.replace(FOOTNOTES, " ");
  return rankByLabel.get(foldWords(withoutNotes))
    ?? rankByLabel.get(foldWords(withoutNotes.replace(/\s*\([^()]*\)\s*$/u, "")))
    ?? [];
}

export type WorkbookHeaderCell = { column: number; text: string };

/**
 * The best column for each role among the header cells: one column serves one role at most. Two columns that
 * could serve the same role are not an error; the better synonym is chosen, the user decides.
 */
export function detectWorkbookColumns(cells: readonly WorkbookHeaderCell[]): Partial<Record<WorkbookRole, number>> {
  const candidates = cells.flatMap(({ column, text }) => headerRoles(text).map(({ role, rank }) => ({ column, role, rank })))
    .sort((left, right) => left.rank - right.rank || left.column - right.column
      || WORKBOOK_ROLES.indexOf(left.role) - WORKBOOK_ROLES.indexOf(right.role));
  const columns: Partial<Record<WorkbookRole, number>> = {};
  const taken = new Set<number>();
  for (const { column, role } of candidates) {
    if (columns[role] !== undefined || taken.has(column)) continue;
    columns[role] = column;
    taken.add(column);
  }
  return columns;
}

/** A header row names a designation column and at least one other recognized column. */
export function isWorkbookHeaderRow(columns: Partial<Record<WorkbookRole, number>>): boolean {
  return columns.designation !== undefined && Object.keys(columns).length > 1;
}

/** A cell that repeats the header recognized for its own column: a header repeated further down the sheet. */
export function isWorkbookHeaderText(text: string, role: WorkbookRole): boolean {
  return headerRoles(text).some((entry) => entry.role === role);
}

export function workbookColumnLetter(index: number): string {
  let letter = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letter = String.fromCharCode(65 + ((rest - 1) % 26)) + letter;
  }
  return letter;
}

export function workbookColumnIndex(letter: string): number {
  return [...letter.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

export const WORKBOOK_COLUMN_LETTER = /^[A-Z]{1,3}$/;

/** `designation:B,quantity:E`, the form the preview's `columns` parameter takes. */
export function formatWorkbookMapping(mapping: WorkbookMapping): string {
  return WORKBOOK_ROLES.flatMap((role) => (mapping[role] ? [`${role}:${mapping[role]}`] : [])).join(",");
}

/**
 * A mapping where a column serves one role at most: a later role that repeats a column already taken loses it.
 * Used on what comes back from the browser's storage, which the user may have edited or an older version written.
 */
export function distinctWorkbookMapping(mapping: WorkbookMapping): WorkbookMapping {
  const next: WorkbookMapping = {};
  const taken = new Set<string>();
  for (const role of WORKBOOK_ROLES) {
    const letter = mapping[role];
    if (!letter || taken.has(letter)) continue;
    next[role] = letter;
    taken.add(letter);
  }
  return next;
}

export function sameWorkbookMapping(left: WorkbookMapping, right: WorkbookMapping): boolean {
  return formatWorkbookMapping(left) === formatWorkbookMapping(right);
}

/**
 * What identifies a layout of columns for the browser's memory: the folded headers by column. Two workbooks
 * written from the same template share it, whatever their rows.
 */
export function workbookHeaderSignature(columns: ReadonlyArray<{ column: string; header: string }>): string {
  return columns.filter(({ header }) => header.trim()).map(({ column, header }) => `${column}=${normalizeWorkbookHeader(header)}`).join("|");
}

/**
 * A fractional quantity is ordered as the whole unit above it (125,36 m becomes 126 m). Answers the rounded
 * quantity, and the source when it was rounded; zero, negative or unreadable is no quantity.
 */
export function roundUpWorkbookQuantity(value: number | null): { quantity: number | null; roundedFrom: number | null } {
  if (value === null || !Number.isFinite(value) || value <= 0) return { quantity: null, roundedFrom: null };
  // Float noise from a formula (2.0000000001) is not a fraction the author wrote.
  const settled = Math.round(value * 1e6) / 1e6;
  const quantity = Math.ceil(settled);
  return { quantity, roundedFrom: quantity === settled ? null : settled };
}

/** One token of a code: letters, digits and the separators codes use, with at least one digit. */
const CODE_TOKEN = /^(?=[^\d]*\d)[A-Za-z0-9][A-Za-z0-9.\-_/+]*$/u;
/** What Excel shows for a long number in General format (« 3.24506E+12 »): its digits are lost, it is no code. */
const SCIENTIFIC = /^[-+]?\d+(?:[.,]\d+)?e[-+]?\d+$/iu;

/**
 * The reference is kept only when the cell holds a single code and nothing else: a slash inside a code and one
 * space between two parts of it are allowed (« RMP16LFM18X1/2 », « TSP04L 28X1.2 »); alternatives (« ou », « / »
 * between spaces, two numbers side by side), remarks in brackets, a second sentence, words without digits or a
 * number in scientific notation are not a code.
 */
export function workbookReferenceCode(text: string | undefined): string | null {
  const value = text?.trim() ?? "";
  if (!value || value.length > 120 || SCIENTIFIC.test(value)) return null;
  const tokens = value.split(" ");
  if (tokens.length > 2 || tokens.some((token) => !CODE_TOKEN.test(token))) return null;
  if (tokens.length === 2 && tokens.every((token) => /^\d+$/u.test(token))) return null;
  return value;
}

/**
 * The text of a numeric reference cell. Excel's shown text loses digits in General format (« 3.24506E+12 ») and adds
 * separators with a thousands format (« 8 199 »): for General and plain number formats the stored whole number is
 * read as its digits. A zero-padded format (« 000000 ») keeps its shown text, leading zeros included.
 */
export function workbookNumericReferenceText(value: number, format: string | undefined, shown: string | undefined): string {
  const pattern = (format ?? "General").trim();
  const integerPart = pattern.split(".")[0]?.replace(/,/g, "") ?? "";
  const padded = /^0{2,}$/u.test(integerPart);
  const plain = /^general$/iu.test(pattern) || /^[#0,]+(?:\.[#0]+)?$/u.test(pattern);
  if (!padded && plain && Number.isSafeInteger(value)) return String(value);
  return (shown ?? String(value)).trim();
}

/** Wording that says the author still doubts, matched on folded words (accents and case aside). */
const DOUBT = /\ba (?:confirmer|verifier|preciser|identifier|valider|relever|determiner|proposer|definir)\b/u;

export function hasWrittenDoubt(...texts: ReadonlyArray<string | null | undefined>): boolean {
  return texts.some((text) => text && DOUBT.test(foldWords(text)));
}

/** What separates the parts of a dimension cell (« 32 · Sertissage ; FF/MF à confirmer »); a slash, an arrow or « × » does not. */
const DIMENSION_SEPARATOR = /(\s*[\u00b7;]\s*)/u;

export function hasWorkbookDimensionParts(text: string): boolean {
  return /[\u00b7;]/u.test(text);
}

/**
 * A dimension cell cut into its parts (owner's decision of 2026-11-27): the first part is the dimension, the others
 * the precision, joined with the separators that preceded them; a part that expresses a doubt is dropped from both
 * and reported. Nothing is interpreted: « 32 » stays « 32 ». A doubtful first part leaves the dimension empty.
 */
export function splitWorkbookDimension(text: string): { dimension: string | null; precision: string | null; dropped: string[] } {
  const pieces = text.split(DIMENSION_SEPARATOR);
  const parts: Array<{ separator: string; text: string }> = [];
  for (let index = 0; index < pieces.length; index += 2) {
    const part = pieces[index]?.trim() ?? "";
    if (part) parts.push({ separator: index === 0 ? "" : pieces[index - 1] ?? "", text: part });
  }
  const dropped = parts.filter((part) => hasWrittenDoubt(part.text)).map((part) => part.text);
  const [first, ...rest] = parts;
  const dimension = first && !hasWrittenDoubt(first.text) ? first.text : null;
  const kept = rest.filter((part) => !hasWrittenDoubt(part.text));
  const precision = kept.map((part, index) => (index === 0 ? part.text : `${part.separator}${part.text}`)).join("") || null;
  return { dimension, precision, dropped };
}
