import { aliasKey, matchLine, prepareCatalogue, unitsDiffer, type MatchArticle } from "@/lib/material-requests/matching";
import { compareSizes, readSize } from "@/lib/material-requests/size-keys";
import { foldText, foldWords } from "@/lib/text/fold";

import type { SupplierBaseGap } from "./supplier-base-contract";

const MAX_MATCHES = 3;
const MAX_RANKED_CANDIDATES = 160;
const MATERIAL_WORDS = /\b(?:acier galvanise|acier carbone|acier inoxydable|inox|acier|cuivre|laiton|bronze|fonte|aluminium|multicouche|pvc|pehd|ppr|per|polyethylene|polypropylene|caoutchouc|epdm|ptfe)\b/u;
const PRECISION_WORDS = /\b(?:[1234]\d{2}l?|a[24]|pn\s*\d+|(?:en|iso|din)\s*\d{3,5})\b/gu;
const SIZE_EXPRESSION = /\b\d+(?:[.,]\d+)?(?:\s*[x×/]\s*\d+(?:[.,]\d+)?){1,3}(?:\s*mm)?\b/u;

const wordingKey = (text: string) => foldText(text).trim().replace(/\s+/gu, " ");

function dimensionKey(value: string) {
  return wordingKey(value).replace(/\s|mm$/gu, "").replace(/×/gu, "x").replace(/,/gu, ".")
    .replace(/\d+(?:\.\d+)?/gu, (part) => {
      const [whole, fraction] = part.split(".");
      const normalized = fraction?.replace(/0+$/u, "");
      return whole.replace(/^0+(?=\d)/u, "") + (normalized ? `.${normalized}` : "");
    });
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
  const dimensions = SIZE_EXPRESSION.exec(dimensionText)?.[0] ?? null;
  const dimension = article.dimensions || dimensions || article.designation;
  return {
    article,
    material,
    dimension,
    size: readSize(dimension, material),
    dimensions: dimensions ? dimensionKey(dimensions) : null,
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
  // The common size reader compares diameters. Keep additional dimensions such as wall thickness here.
  if (left.dimensions && right.dimensions) size = left.dimensions === right.dimensions ? "same" : "different";
  else if (left.size?.od != null && right.size?.od != null && left.size.od !== right.size.od) size = "different";
  else if (size === "same" && Boolean(left.size?.reduce ?? left.size?.reduceOd) !== Boolean(right.size?.reduce ?? right.size?.reduceOd)) size = "unknown";
  const material = !left.material || !right.material ? "unknown" : left.material === right.material ? "same" : "different";
  return { sameWording, size, material } as const;
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
  if (comparison.size === "different" || comparison.material === "different") return null;
  return proposalGaps(left, right, comparison);
}

export function createSupplierBaseMatcher<T extends MatchArticle>(articles: readonly T[]) {
  const descriptions = new Map(articles.map((article) => [article.id, describe(article)]));
  const prepared = new Map(prepareCatalogue(articles.map((article) => {
    const description = descriptions.get(article.id)!;
    return { ...article, material: description.material, dimensions: description.dimension, grade: description.precision };
  })).map((item) => [item.article.id, item]));
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
      if (size === "different" || material === "different") return [];
      if (workbook && !sameWording && (size !== "same" || material !== "same")) return [];
      const rank = 8 * Number(sameWording || alias) + 4 * Number(size === "same") + 2 * Number(material === "same");
      return [{ article, right, comparison, rank }];
    }).sort((a, b) => b.rank - a.rank).slice(0, MAX_RANKED_CANDIDATES);

    const matched = matchLine({
      reference: null,
      product_type: line.designation,
      material: left.material,
      material_precision: left.precision,
      dimension: left.dimension,
      unit: line.unit,
    }, candidates.map(({ article }) => prepared.get(article.id)!), { limit: candidates.length });
    const byId = new Map(matched.map((candidate) => [candidate.product_id, candidate]));

    return candidates.flatMap(({ article, right, comparison, rank }) => {
      const match = byId.get(article.id);
      if (!match && !comparison.sameWording) return [];
      return { article, gaps: proposalGaps(left, right, comparison), rank, score: match?.score ?? 0 };
    }).sort((a, b) => b.rank - a.rank || b.score - a.score).slice(0, MAX_MATCHES);
  };
}
