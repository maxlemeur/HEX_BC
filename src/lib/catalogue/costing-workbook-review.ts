import {
  workbookReferenceKey,
  workbookSupplierNameKey,
  type CostingWorkbookArticle,
  type CostingWorkbookColumn,
  type CostingWorkbookColumnInspection,
  type CostingWorkbookSupplierOccurrence,
} from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookSupplierReferenceReport } from "@/lib/catalogue/costing-workbook-contract";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import { levenshteinDistance, normalizeCompareText } from "@/lib/text/fuzzy-compare";

/**
 * What the import screen works out from the sheet it holds (TI-711), without the server: what to check on a
 * proposed draft, which columns the reader misses and what that costs, how the cells to examine group by the
 * one thing to fix, and which catalogue suppliers a workbook name looks like.
 */

export type SupplierDecision = CostingWorkbookSupplierReferenceReport["for_decision"][number];
export type SupplierDecisionReason = SupplierDecision["reason"];

/** What the office checks on a proposed draft before importing it. */
export type ArticleFinding = "price_missing" | "unit_defaulted" | "supply_type_defaulted" | "without_supply_type" | "material_missing" | "unit_unknown" | "reference_repeated" | "possible_duplicate";

export const ARTICLE_FINDINGS: Record<ArticleFinding, { label: string; short: string }> = {
  price_missing: { label: "Sans prix (0 €)", short: "sans prix" },
  unit_defaulted: { label: "Unité absente, « u » retenue", short: "unité par défaut" },
  supply_type_defaulted: { label: "Classé « divers » par défaut", short: "classé par défaut" },
  without_supply_type: { label: "Sans type de fourniture", short: "sans type" },
  material_missing: { label: "Sans matière", short: "sans matière" },
  unit_unknown: { label: "Unité non reconnue", short: "unité non reconnue" },
  reference_repeated: { label: "Référence répétée dans le classeur", short: "référence répétée" },
  possible_duplicate: { label: "Doublon possible au catalogue", short: "doublon possible" },
};

export function articleFindings(
  article: CostingWorkbookArticle,
  withoutSupplyType: boolean,
  { typeChosen = false, referenceRepeated = false, possibleDuplicate = false } = {},
): ArticleFinding[] {
  const findings: ArticleFinding[] = [];
  if (article.unit_price_cents === 0) findings.push("price_missing");
  if (article.unit_defaulted) findings.push("unit_defaulted");
  else if (!normalizeMeasurementUnit(article.unit).unitCode) findings.push("unit_unknown");
  if (withoutSupplyType) findings.push("without_supply_type");
  else if (article.supply_type_defaulted && !typeChosen) findings.push("supply_type_defaulted");
  if (!article.material) findings.push("material_missing");
  if (referenceRepeated) findings.push("reference_repeated");
  if (possibleDuplicate) findings.push("possible_duplicate");
  return findings;
}

/** What a missing optional column costs the import, said before the import. Columns left out cost nothing to say. */
const MISSING_COLUMN_EFFECT: Partial<Record<CostingWorkbookColumn, string>> = {
  "PR. FO": "tous les articles seraient importés sans prix (0 €)",
  "Unité": "tous les articles prendraient l’unité « u »",
  "Type FO": "le type de fourniture serait déduit du libellé seul",
  "Fiabilité (/10)": "aucun article n’aurait de note de fiabilité",
  "Dimension": "aucun article n’aurait de dimension",
};

export function missingColumnEffect(column: CostingWorkbookColumn): string | null {
  const supplier = /^F([123])_(nom|ref)$/.exec(column);
  if (supplier) return `les références du fournisseur ${supplier[1]} ne seraient pas lues`;
  return MISSING_COLUMN_EFFECT[column] ?? null;
}

/** The missing columns whose absence changes what is imported, each with its consequence. */
export function missingColumnWarnings(inspection: CostingWorkbookColumnInspection) {
  // A workbook with one or two suppliers has no F3 columns: only a pair cut in half is worth a word.
  const missing = new Set(inspection.missingOptional);
  return inspection.missingOptional.flatMap((column) => {
    const supplier = /^F([123])_(nom|ref)$/.exec(column);
    if (supplier) {
      const twin = `F${supplier[1]}_${supplier[2] === "nom" ? "ref" : "nom"}` as CostingWorkbookColumn;
      if (missing.has(twin)) return [];
    }
    const effect = missingColumnEffect(column);
    return effect ? [{ column, effect }] : [];
  });
}

const COMPANY_WORDS = new Set([
  "sa", "sas", "sasu", "sarl", "eurl", "sci", "snc", "scop", "ste", "societe", "ets", "etablissement", "etablissements",
  "groupe", "group", "cie", "compagnie", "france", "et", "de", "des", "du", "la", "le", "les",
]);

function nameWords(name: string): string[] {
  const words = normalizeCompareText(name).split(" ").filter(Boolean);
  const kept = words.filter((word) => !COMPANY_WORDS.has(word));
  return kept.length > 0 ? kept : words;
}

/** « pt » for « point », « mat » for « materiaux »: the same first letter, then letters of the word in its order. */
function abbreviates(short: string, word: string): boolean {
  if (short === word) return true;
  if (short.length < 2 || short[0] !== word[0]) return false;
  let position = 0;
  for (const letter of short) {
    position = word.indexOf(letter, position) + 1;
    if (position === 0) return false;
  }
  return true;
}

/** Each word of the shorter name is, in order, a word of the longer one or its abbreviation. */
function abbreviatesName(short: readonly string[], long: readonly string[]): boolean {
  let next = 0;
  for (const word of short) {
    while (next < long.length && !abbreviates(word, long[next])) next += 1;
    if (next === long.length) return false;
    next += 1;
  }
  return true;
}

/**
 * How close two supplier names are, from 0 to 1: the same once legal forms and punctuation are dropped (1), one
 * made of the other's words (« Point P » in « Point P Matériaux », 0,9), one the start of the other (0,85), its
 * initials (« PUM », 0,8), its words abbreviated (« Pt.P », 0,75), else the share of letters to change.
 */
export function supplierNameSimilarity(left: string, right: string): number {
  const a = nameWords(left);
  const b = nameWords(right);
  if (a.length === 0 || b.length === 0) return 0;
  const joinedA = a.join("");
  const joinedB = b.join("");
  if (joinedA === joinedB) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.every((word) => long.includes(word))) return 0.9;
  const [shortText, longText] = joinedA.length <= joinedB.length ? [joinedA, joinedB] : [joinedB, joinedA];
  if (shortText.length >= 3 && longText.startsWith(shortText)) return 0.85;
  // Initials: « PUM » for « Plastiques Union Matériaux ».
  if (shortText.length >= 2 && long.length >= 2 && long.map((word) => word[0]).join("") === shortText) return 0.8;
  const edits = 1 - levenshteinDistance(joinedA, joinedB) / Math.max(joinedA.length, joinedB.length);
  return abbreviatesName(short, long) ? Math.max(0.75, edits) : edits;
}

export type SupplierDirectoryItem = { id: string; name: string; label: string };
export type SupplierCandidate = SupplierDirectoryItem & { score: number };

/** The catalogue suppliers a workbook name looks like, closest first; none below `minimum`. */
export function rankSupplierCandidates(
  name: string,
  directory: readonly SupplierDirectoryItem[],
  { limit = 3, minimum = 0.6 }: { limit?: number; minimum?: number } = {},
): SupplierCandidate[] {
  return directory
    .map((supplier) => ({ ...supplier, score: supplierNameSimilarity(name, supplier.name) }))
    .filter((candidate) => candidate.score >= minimum)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "fr"))
    .slice(0, limit);
}

/** What one fix resolves: every cell of an article, every cell of a supplier name, or one cell. */
export type DecisionGroupKind = "article" | "supplier" | "cell";

const GROUP_KIND: Partial<Record<SupplierDecisionReason, DecisionGroupKind>> = {
  article_to_create: "article",
  article_not_found: "article",
  ambiguous_article: "article",
  supplier_not_found: "supplier",
  ambiguous_supplier: "supplier",
  invalid_supplier_name: "supplier",
};

export function decisionGroupKind(reason: SupplierDecisionReason): DecisionGroupKind {
  return GROUP_KIND[reason] ?? "cell";
}

export const decisionCellKey = (cell: { row: number; slot: number }) => `${cell.row}-${cell.slot}`;

export type DecisionGroup = {
  key: string;
  kind: DecisionGroupKind;
  /** The article identifier or the supplier name the group shares; empty for a single cell. */
  label: string;
  entries: SupplierDecision[];
};

/**
 * The decisions by the one thing to fix. A reason about the article groups its cells by article, a reason
 * about the supplier by supplier name; a cell without that identifier or name, and any other reason, stands
 * alone. Groups keep the sheet order of their first cell.
 */
export function groupSupplierDecisions(
  decisions: readonly SupplierDecision[],
  sourceByCell: ReadonlyMap<string, CostingWorkbookSupplierOccurrence>,
  grouped: boolean,
): DecisionGroup[] {
  const groups = new Map<string, DecisionGroup>();
  for (const entry of decisions) {
    const cellKey = decisionCellKey(entry);
    const source = sourceByCell.get(cellKey);
    const kind = grouped ? decisionGroupKind(entry.reason) : "cell";
    let key = `cell:${cellKey}`;
    let label = "";
    if (kind === "article" && source?.article_reference_valid) {
      key = `article:${workbookReferenceKey(source.article_reference)}`;
      label = source.article_reference;
    } else if (kind === "supplier" && source?.supplier_name) {
      key = `supplier:${workbookSupplierNameKey(source.supplier_name)}`;
      label = source.supplier_name;
    }
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { key, kind: key.startsWith("cell:") ? "cell" : kind, label, entries: [entry] });
  }
  return [...groups.values()];
}
