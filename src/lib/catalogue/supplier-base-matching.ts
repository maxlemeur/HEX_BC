import { aliasKey, matchLine, prepareCatalogue, unitsDiffer, type MatchArticle, type PreparedCatalogue } from "@/lib/material-requests/matching";
import { compareSizes, readSize, type SizeReading } from "@/lib/material-requests/size-keys";
import { foldText, foldWords } from "@/lib/text/fold";

import type { SupplierBaseGap } from "./supplier-base-contract";

const MAX_MATCHES = 3;
const MAX_RANKED_CANDIDATES = 160;
const MATERIAL_WORDS = /\b(?:acier galvanise|acier carbone|acier inoxydable|inox|acier|cuivre|laiton|bronze|fonte|aluminium|multicouche|pvc|pehd|ppr|per|polyethylene|polypropylene|caoutchouc|epdm|ptfe)\b/u;
const PRECISION_WORDS = /\b(?:[1234]\d{2}l?|a[24]|pn\s*\d+|(?:en|iso|din)\s*\d{3,5})\b/gu;
const DIMENSION_NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const DIMENSION_MARKER = String.raw`(?:dn|[ø⌀]|m)\s*`;
const DIMENSION_UNIT = String.raw`(?:mm|cm|m)\b`;
const DIMENSION_COMPONENT = String.raw`(?:${DIMENSION_MARKER})?${DIMENSION_NUMBER}(?:\s*${DIMENSION_UNIT})?`;
const DIMENSION_EXPRESSION = new RegExp(
  String.raw`(?<![\p{L}\d.,])(?:${DIMENSION_COMPONENT}(?:\s*[x×/>*-]\s*${DIMENSION_COMPONENT})+|${DIMENSION_MARKER}${DIMENSION_NUMBER}(?:\s*${DIMENSION_UNIT})?|${DIMENSION_NUMBER}\s*${DIMENSION_UNIT})(?![\d.,])`,
  "giu",
);

const wordingKey = (text: string) => foldText(text).trim().replace(/\s+/gu, " ");

function dimensionKey(value: string) {
  return wordingKey(value).replace(/\s/gu, "").replace(/×/gu, "x").replace(/,/gu, ".")
    .replace(/\d+(?:\.\d+)?/gu, (part) => {
      const [whole, fraction] = part.split(".");
      const normalized = fraction?.replace(/0+$/u, "");
      return whole.replace(/^0+(?=\d)/u, "") + (normalized ? `.${normalized}` : "");
    });
}

/** A parsed diameter can stand for a written expression only if it includes all its components. */
function sizeCoversExpression(size: SizeReading | null, expression: string) {
  if (!size) return false;
  const text = foldText(expression);
  const values = (text.match(/\d+(?:[.,]\d+)?/gu) ?? []).map((value) => Number(value.replace(",", ".")));
  const hasDiameterMarker = /^[ø⌀]/u.test(text);
  // A written measurement may be a length or a thickness. Only explicit diameters in mm are covered.
  if (/\d\s*(?:cm|m)\b/u.test(text) || (!hasDiameterMarker && /\d\s*mm\b/u.test(text))) return false;
  let parsed: Array<number | null>;
  if (/^dn/u.test(text)) parsed = [size.dn, size.reduce];
  else if (hasDiameterMarker) parsed = [size.od, size.reduceOd];
  else if (/^m\s*\d/u.test(text)) parsed = [size.metric];
  else parsed = size.od === null ? [size.dn, size.reduce] : [size.od, size.reduceOd];
  return values.length === (parsed[1] == null ? 1 : 2) && values.every((value, index) => value === parsed[index]);
}

function materialOf(text: string): string | null {
  const found = MATERIAL_WORDS.exec(foldWords(text))?.[0] ?? null;
  return found === "acier inoxydable" ? "inox" : found;
}

function typeHead(text: string): string | null {
  for (const word of foldWords(text).split(" ")) {
    if (/^[a-z]/u.test(word)) {
      const key = aliasKey(word);
      if (key) return key;
    }
  }
  return null;
}

function describe(article: MatchArticle) {
  const material = (article.material && (materialOf(article.material) ?? foldWords(article.material))) || materialOf(article.designation);
  const dimensionText = article.dimensions?.trim() || article.designation;
  const expressions = dimensionText.match(DIMENSION_EXPRESSION) ?? [];
  const writtenSize = readSize(dimensionText, material);
  const dimension = writtenSize ? dimensionText : expressions[0] ?? dimensionText;
  const size = writtenSize ?? readSize(expressions[0], material);
  const designationExpressions = dimensionText === article.designation ? [] : article.designation.match(DIMENSION_EXPRESSION) ?? [];
  const remainingDimensions = [...new Set([...expressions, ...designationExpressions]
    .filter((expression) => !sizeCoversExpression(size, expression))
    .map(dimensionKey))].join("|");
  return {
    article,
    material,
    dimension,
    size,
    remainingDimensions,
    precision: [article.grade, article.standard].filter(Boolean).join(" ")
      || [...foldWords(article.designation).matchAll(PRECISION_WORDS)].map(([word]) => word).join(" ") || null,
    wording: wordingKey(article.designation),
    aliases: new Set(article.aliases.map(aliasKey).filter(Boolean)),
    heads: new Set([typeHead(article.product_type ?? ""), typeHead(article.designation)].filter((key) => key !== null)),
  };
}

type Description = ReturnType<typeof describe>;

function compare(left: Description, right: Description) {
  const sameWording = left.wording === right.wording;
  let size = compareSizes(left.size, right.size);
  const outerDiameterDiffers = left.size?.od != null && right.size?.od != null && left.size.od !== right.size.od;
  const reducedDiameterDiffers = left.size?.reduceOd != null && right.size?.reduceOd != null && left.size.reduceOd !== right.size.reduceOd;
  if (outerDiameterDiffers || reducedDiameterDiffers) size = "different";
  else if (size === "same" && Boolean(left.size?.reduce ?? left.size?.reduceOd) !== Boolean(right.size?.reduce ?? right.size?.reduceOd)) size = "unknown";
  if (size !== "different" && (left.remainingDimensions || right.remainingDimensions)) {
    if (!left.remainingDimensions || !right.remainingDimensions) size = "unknown";
    else if (left.remainingDimensions !== right.remainingDimensions) size = "different";
    else if (!left.size && !right.size) size = "same";
  }
  const material = !left.material || !right.material ? "unknown" : left.material === right.material ? "same" : "different";
  return { sameWording, size, material, compatible: size !== "different" && material !== "different" } as const;
}

function catalogueMatchFields({ article, material, dimension, precision }: Description): MatchArticle {
  return { ...article, material, dimensions: dimension, grade: precision };
}

function matchCompatibleTargets(left: Description, targets: PreparedCatalogue, exactDesignationIds: ReadonlySet<string>) {
  return matchLine({
    reference: null,
    product_type: left.article.designation,
    material: left.material,
    material_precision: left.precision,
    dimension: left.dimension,
    unit: left.article.unit,
  }, targets, {
    limit: targets.length,
    allowLowScore: (article) => exactDesignationIds.has(article.id),
  });
}

function proposalGaps(left: Description, right: Description, comparison: ReturnType<typeof compare>): SupplierBaseGap[] {
  const gaps: SupplierBaseGap[] = [];
  if (comparison.size === "unknown") gaps.push("dimension_unknown");
  if (comparison.material === "unknown") gaps.push("material_unknown");
  if (!left.article.unit || !right.article.unit) gaps.push("unit_unknown");
  else if (unitsDiffer(left.article.unit, right.article.unit)) gaps.push("unit_mismatch");
  if (![...left.heads].some((head) => right.heads.has(head))) gaps.push("type_unknown");
  if (foldWords(left.precision ?? "") !== foldWords(right.precision ?? "")) gaps.push("precision_check");
  if (right.article.catalogue_status === "draft") gaps.push("draft_article");
  return gaps;
}

/** Check the actual target as well when a workbook peer already has a catalogue reference. */
export function supplierBaseLinkedArticleGaps(line: MatchArticle, article: MatchArticle): SupplierBaseGap[] | null {
  const left = describe(line);
  const right = describe(article);
  const comparison = compare(left, right);
  if (!comparison.compatible) return null;
  const exactDesignationIds = new Set(comparison.sameWording ? [article.id] : []);
  const [match] = matchCompatibleTargets(left, prepareCatalogue([catalogueMatchFields(right)]), exactDesignationIds);
  return match ? proposalGaps(left, right, comparison) : null;
}

export function createSupplierBaseMatcher<T extends MatchArticle>(articles: readonly T[]) {
  const descriptions = new Map(articles.map((article) => [article.id, describe(article)]));
  const prepared = new Map(prepareCatalogue([...descriptions.values()].map(catalogueMatchFields))
    .map((item) => [item.article.id, item]));
  const index = new Map<string, T[]>();

  for (const article of articles) {
    const description = descriptions.get(article.id)!;
    const keys = [
      ...[...description.heads].map((head) => `type:${head}`),
      `designation:${description.wording}`,
      ...[...description.aliases].map((key) => `alias:${key}`),
    ];
    for (const key of new Set(keys)) {
      const entries = index.get(key) ?? [];
      entries.push(article);
      index.set(key, entries);
    }
  }

  return (line: MatchArticle, eligible: (article: T) => boolean, workbook = false) => {
    const left = describe(line);
    const lineAliasKey = aliasKey(line.designation);
    const keys = [
      ...[...left.heads].map((head) => `type:${head}`),
      `designation:${left.wording}`,
      `alias:${lineAliasKey}`,
    ];
    const candidates = [...new Set(keys.flatMap((key) => index.get(key) ?? []))].flatMap((article) => {
      if (!eligible(article)) return [];
      const right = descriptions.get(article.id)!;
      const comparison = compare(left, right);
      const alias = right.aliases.has(lineAliasKey);
      const { sameWording, size, material } = comparison;
      if (!comparison.compatible) return [];
      if (workbook && !sameWording && (size !== "same" || material !== "same")) return [];
      const rank = 8 * Number(sameWording || alias) + 4 * Number(size === "same") + 2 * Number(material === "same");
      return [{ article, right, comparison, rank }];
    }).sort((a, b) => b.rank - a.rank).slice(0, MAX_RANKED_CANDIDATES);

    const exactDesignationIds = new Set(candidates.flatMap(({ article, comparison }) => comparison.sameWording ? [article.id] : []));
    const matched = matchCompatibleTargets(left, candidates.map(({ article }) => prepared.get(article.id)!), exactDesignationIds);
    const byId = new Map(matched.map((candidate) => [candidate.product_id, candidate]));

    return candidates.flatMap(({ article, right, comparison, rank }) => {
      const match = byId.get(article.id);
      if (!match) return [];
      return { article, gaps: proposalGaps(left, right, comparison), rank, score: match.score };
    }).sort((a, b) => b.rank - a.rank || b.score - a.score).slice(0, MAX_MATCHES);
  };
}
