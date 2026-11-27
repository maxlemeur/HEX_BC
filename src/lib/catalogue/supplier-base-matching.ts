import { aliasKey, matchLine, prepareCatalogue, unitsDiffer, type MatchArticle } from "@/lib/material-requests/matching";
import { compareSizes, readSize } from "@/lib/material-requests/size-keys";
import { foldText, foldWords } from "@/lib/text/fold";

const MAX_MATCHES = 3;
const MAX_RANKED_CANDIDATES = 160;
const MATERIAL_WORDS = /\b(?:acier galvanise|acier carbone|acier inoxydable|inox|acier|cuivre|laiton|bronze|fonte|aluminium|multicouche|pvc|pehd|ppr|per|polyethylene|polypropylene|caoutchouc|epdm|ptfe)\b/u;
const PRECISION_WORDS = /\b(?:[1234]\d{2}l?|a[24]|pn\s*\d+|(?:en|iso|din)\s*\d{3,5})\b/gu;
const SIZE_EXPRESSION = /\b\d+(?:[.,]\d+)?(?:\s*[x×/]\s*\d+(?:[.,]\d+)?){1,3}(?:\s*mm)?\b/u;

const wordingKey = (text: string) => foldText(text).trim().replace(/\s+/gu, " ");

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
    dimensions: dimensions ? wordingKey(dimensions).replace(/\s|mm$/gu, "").replace(/×/gu, "x").replace(/,/gu, ".") : null,
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
  const material = !left.material || !right.material ? "unknown" : left.material === right.material ? "same" : "different";
  return { sameWording, size, material } as const;
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
      if (workbook && !sameWording && (size !== "same" || material !== "same")) return [];
      if (!sameWording && !alias && (size === "different" || material === "different") && size !== "same" && material !== "same") return [];
      const rank = 8 * Number(sameWording || alias) + 4 * Number(size === "same") + 2 * Number(material === "same")
        - Number(size === "different") - Number(material === "different");
      return [{ article, right, comparison, rank }];
    }).sort((a, b) => b.rank - a.rank).slice(0, MAX_RANKED_CANDIDATES);

    const matched = matchLine({
      reference: null,
      product_type: line.designation,
      material: left.material,
      material_precision: left.precision,
      dimension: left.dimension,
      unit: line.unit,
    }, candidates.map(({ article }) => prepared.get(article.id)!), { byHand: true, limit: candidates.length });
    const byId = new Map(matched.map((candidate) => [candidate.product_id, candidate]));

    return candidates.flatMap(({ article, right, comparison, rank }) => {
      const match = byId.get(article.id);
      if (!match && !comparison.sameWording) return [];
      const gaps = [];
      if (comparison.size === "different") gaps.push("Dimensions différentes.");
      if (comparison.size === "unknown") gaps.push("Dimension à confirmer.");
      if (comparison.material === "different") gaps.push("Matières différentes.");
      if (comparison.material === "unknown") gaps.push("Matière à confirmer.");
      if (!line.unit || !right.article.unit) gaps.push("Unité à confirmer.");
      else if (!match && unitsDiffer(line.unit, right.article.unit)) gaps.push("Unités différentes.");
      if (!comparison.sameWording && left.precision !== right.precision) gaps.push("Nuance ou norme à confirmer.");
      gaps.push(...(match?.warnings ?? []));
      return [{ article, gaps: [...new Set(gaps)], rank, score: match?.score ?? 0 }];
    }).sort((a, b) => b.rank - a.rank || b.score - a.score).slice(0, MAX_MATCHES);
  };
}
