import { foldText } from "@/lib/text/fold";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

import { compareSizes, readSize, type SizeReading } from "./size-keys";

/**
 * Proposes catalogue articles for a request line (TI-690, delivery 3). Deterministic, no AI: the office
 * reads the proposals and chooses; nothing is linked without that choice.
 *
 * Order of trust:
 *  1. a reference written by the technician that is ours or a supplier's: first, flagged when the line
 *     describes another size;
 *  2. a usual name the office has taught for that article (learned when it links a line);
 *  3. the closest articles by type words, material and size.
 * Never proposed: another size, another material, another stainless grade. « inox » alone keeps every
 * stainless grade: the office then picks the one it orders.
 */

export type MatchRequestLine = {
  reference: string | null;
  product_type: string | null;
  /** The line's own material, else the request's presumed material: a hint for the proposals. */
  material: string | null;
  material_precision: string | null;
  dimension: string | null;
  unit: string | null;
};

export type MatchArticle = {
  id: string;
  reference: string | null;
  designation: string;
  product_type: string | null;
  material: string | null;
  grade: string | null;
  dimensions: string | null;
  standard: string | null;
  unit: string | null;
  catalogue_status: "draft" | "validated";
  supplier_skus: readonly string[];
  /** Usual names the office has taught for this article. */
  aliases: readonly string[];
};

export type MatchCandidate = {
  product_id: string;
  /** 0 to 100, for ordering only. */
  score: number;
  via: "reference" | "alias" | "ranked";
  /** Why it is proposed, in words the office reads. */
  reasons: string[];
  /** What to check before choosing it. */
  warnings: string[];
};

type PreparedArticle = {
  article: MatchArticle;
  words: ReadonlySet<string>;
  angle: number | null;
  materialWords: ReadonlySet<string>;
  size: SizeReading | null;
  sizeLabel: string | null;
  references: ReadonlySet<string>;
  aliases: ReadonlySet<string>;
  unitCode: string | null;
};

export type PreparedCatalogue = readonly PreparedArticle[];

const MAX_CANDIDATES = 5;
const MIN_SCORE = 40;
const MIN_TYPE_SIMILARITY = 0.34;
const STOP_WORDS = new Set(["a", "au", "aux", "avec", "de", "des", "du", "en", "et", "la", "le", "les", "pour", "sur", "un", "une"]);
/** Technicians' abbreviations, folded. Usual names taught by the office cover the rest. */
const ABBREVIATIONS: Record<string, string> = { t: "te", red: "reduction", reduc: "reduction", coud: "coude", vanne: "vanne" };

/** An angle is part of what the piece is (a 45° elbow is not a 90° one): kept as a word, « 45deg ». */
function angleOf(text: string | null | undefined): number | null {
  const match = /(\d{2,3})\s*(?:°|deg(?:res?)?\b)/.exec(foldText(text ?? ""));
  return match ? Number(match[1]) : null;
}

function words(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const angle = angleOf(text);
  if (angle !== null) out.add(`${angle}deg`);
  for (const raw of foldText(text ?? "").split(/[^a-z0-9]+/)) {
    if (!raw || STOP_WORDS.has(raw) || /^\d+$/.test(raw)) continue;
    const word = ABBREVIATIONS[raw] ?? raw;
    out.add(word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word);
  }
  return out;
}

function referenceKey(text: string | null | undefined) {
  return foldText(text ?? "").replace(/[^a-z0-9]/g, "");
}

/** The key a usual name is stored and compared under: its words, folded, sorted. */
export function aliasKey(text: string | null | undefined) {
  return [...words(text)].sort().join(" ");
}

/** One letter added, dropped or changed: a technician's typo in a word of five letters or more. */
function oneEditApart(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1 || Math.min(left.length, right.length) < 5) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (left.length - i) + (right.length - j) <= 1;
}

function found(word: string, in_: ReadonlySet<string>) {
  if (in_.has(word)) return true;
  if (/deg$/.test(word)) return false;
  for (const candidate of in_) if (oneEditApart(word, candidate)) return true;
  return false;
}

function dice(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (found(word, right)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** Share of the line's words found in the article: a short request names a long designation. */
function coverage(line: ReadonlySet<string>, article: ReadonlySet<string>) {
  if (line.size === 0) return 0;
  let count = 0;
  for (const word of line) if (found(word, article)) count += 1;
  return count / line.size;
}

/**
 * How close the line's words are to the article's. A short request names a long designation (coverage),
 * and among articles that hold every word, the one with fewer extra words is closer (dice). A technician
 * names the piece first and describes it after (« vanne eau glacée f/f bleu »): when that first word is
 * the article's, the article is at least a fair proposal, whatever the description adds.
 */
function typeSimilarity(line: ReadonlySet<string>, article: ReadonlySet<string>) {
  const blended = 0.6 * coverage(line, article) + 0.4 * dice(line, article);
  const head = [...line].find((word) => !word.endsWith("deg"));
  return head !== undefined && found(head, article) ? Math.max(blended, 0.5) : blended;
}

function sizeLabel(size: SizeReading | null) {
  if (!size) return null;
  if (size.metric !== null) return `M${size.metric}`;
  if (size.dn !== null) return size.reduce !== null ? `DN ${size.dn} × ${size.reduce}` : `DN ${size.dn}`;
  if (size.od !== null) return `Ø ${size.od}`;
  return null;
}

export function prepareCatalogue(articles: readonly MatchArticle[]): PreparedCatalogue {
  return articles.map((article) => {
    // A size column that holds none (« pour profil 38/24 ») leaves the designation to tell it.
    const size = readSize(article.dimensions, article.material)
      ?? readSize(article.product_type, article.material)
      ?? readSize(article.designation, article.material);
    return {
      article,
      words: new Set([...words(article.product_type), ...words(article.designation)]),
      angle: angleOf(article.product_type) ?? angleOf(article.designation),
      materialWords: words(article.material),
      size,
      sizeLabel: sizeLabel(size),
      references: new Set([article.reference, ...article.supplier_skus].map(referenceKey).filter(Boolean)),
      aliases: new Set(article.aliases.map(aliasKey).filter(Boolean)),
      unitCode: normalizeMeasurementUnit(article.unit).unitCode,
    };
  });
}

type MaterialVerdict = "same" | "family" | "unknown" | "different";

function compareMaterials(line: ReadonlySet<string>, article: ReadonlySet<string>): MaterialVerdict {
  if (line.size === 0 || article.size === 0) return "unknown";
  for (const word of line) if (!article.has(word)) return "different";
  return line.size === article.size ? "same" : "family";
}

export function matchLine(line: MatchRequestLine, catalogue: PreparedCatalogue): MatchCandidate[] {
  const lineWords = words(line.product_type);
  const lineAngle = angleOf(line.product_type);
  const lineMaterial = words(line.material);
  const lineSize = readSize(line.dimension, line.material);
  const lineSizeLabel = sizeLabel(lineSize);
  const lineReference = referenceKey(line.reference);
  const lineAlias = aliasKey(line.product_type);
  const lineUnit = normalizeMeasurementUnit(line.unit).unitCode;

  const candidates: MatchCandidate[] = [];
  for (const entry of catalogue) {
    const size = compareSizes(lineSize, entry.size);
    const material = compareMaterials(lineMaterial, entry.materialWords);
    const reasons: string[] = [];
    const warnings: string[] = [];

    let via: MatchCandidate["via"] = "ranked";
    let score: number;
    if (lineReference.length >= 4 && entry.references.has(lineReference)) {
      via = "reference";
      score = 100;
      reasons.push("Même référence");
      if (size === "different") {
        warnings.push(`La référence désigne une autre dimension (${entry.sizeLabel}) que la ligne (${lineSizeLabel}) : vérifiez.`);
      }
    } else {
      if (size === "different" || material === "different") continue;
      if (lineAngle !== null && entry.angle !== null && lineAngle !== entry.angle) continue;
      if (lineAlias && entry.aliases.has(lineAlias)) {
        via = "alias";
        score = 95;
        reasons.push("Nom usuel appris");
      } else {
        const similarity = typeSimilarity(lineWords, entry.words);
        if (similarity < MIN_TYPE_SIMILARITY) continue;
        score = similarity * 45;
        score += { same: 30, unknown: 10, different: 0 }[size];
        score += { same: 20, family: 14, unknown: 6, different: 0 }[material];
      }
    }

    if (size === "same" && entry.sizeLabel) reasons.push(`Même dimension (${entry.sizeLabel})`);
    if (via !== "reference") {
      if (material === "same") reasons.push("Même matière");
      if (material === "family") reasons.push(`Matière de la famille « ${line.material?.trim()} »`);
    }
    if (lineUnit && entry.unitCode && lineUnit !== entry.unitCode) {
      score -= 10;
      warnings.push(`Unité de l’article : ${entry.article.unit} (ligne : ${line.unit}).`);
    }
    if (entry.article.catalogue_status === "draft") {
      score -= 1;
      warnings.push("Article en brouillon : à valider dans le catalogue.");
    }
    if (via === "ranked" && score < MIN_SCORE) continue;
    candidates.push({ product_id: entry.article.id, score: Math.max(0, Math.min(100, Math.round(score))), via, reasons, warnings });
  }

  const rank = { reference: 0, alias: 1, ranked: 2 } as const;
  return candidates
    .sort((left, right) => rank[left.via] - rank[right.via] || right.score - left.score)
    .slice(0, MAX_CANDIDATES);
}
