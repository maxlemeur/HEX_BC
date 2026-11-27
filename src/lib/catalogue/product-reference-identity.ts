import { compareSizes, readSize } from "@/lib/material-requests/size-keys";
import { foldText } from "@/lib/text/fold";

export type ProductReferenceIdentity = {
  designation?: string | null;
  product_type?: string | null;
  material?: string | null;
  grade?: string | null;
  dimensions?: string | null;
};

export const REFERENCE_FAMILIES = ["tube", "coude", "reduction", "vanne"] as const;
export type ReferenceFamily = (typeof REFERENCE_FAMILIES)[number];

export function referenceFamily(article: ProductReferenceIdentity): ReferenceFamily | null {
  for (const value of [article.product_type, article.designation]) {
    const type = foldText(value ?? "").trim();
    if (/^(tube|tuyau)\b/.test(type)) return "tube";
    if (/^(coude|coud|c(?:45|90))\b/.test(type)) return "coude";
    if (/^(reduction|reducteur|red)\b/.test(type)) return "reduction";
    if (/^(vanne|robinet)\b/.test(type)) return "vanne";
  }
  return null;
}

export function referenceSize(article: ProductReferenceIdentity) {
  // The workbook separates nominal size from precision (e.g. DN50 — 60,3x2).
  const primary = article.dimensions?.split("—")[0]?.trim();
  const pipeDiameter = referenceFamily(article) === "tube" && /^(\d+(?:[.,]\d+)?)\s*[x×]\s*\d+(?:[.,]\d+)?$/i.exec(primary ?? "");
  return readSize(pipeDiameter ? `Ø${pipeDiameter[1]}` : primary, article.material ?? null)
    ?? readSize(article.designation, article.material ?? null);
}

export function referenceGrade(article: ProductReferenceIdentity) {
  const description = foldText(article.designation ?? "");
  const stated = foldText([article.grade, article.material, /\b(inox|acier)\b/.test(description) ? description : null].filter(Boolean).join(" "));
  return /\b(304l?|316l?|s\d{3})\b/.exec(stated)?.[1] ?? null;
}

export function referenceMaterial(article: ProductReferenceIdentity) {
  const known = foldText([article.material, article.designation].filter(Boolean).join(" "));
  return /\b(inox|acier|cuivre|multicouche|pvc|pehd|fonte|per|ppr|laiton)\b/.exec(known)?.[1] ?? null;
}

export function referenceAngle(article: ProductReferenceIdentity) {
  // « 120 °C » is a temperature, not the angle of an elbow. A decimal angle is read whole: « 11,25° » is not 25°.
  return /(?<![\d.,])(\d{2,3}(?:[.,]\d+)?)\s*(?:°|deg(?:res?)?\b\.?)(?!\s*c(?:elsius)?\b)/
    .exec(foldText([article.product_type, article.designation].filter(Boolean).join(" ")))?.[1]?.replace(",", ".") ?? null;
}

export function referencePressure(article: ProductReferenceIdentity) {
  return /\bpn\s*(\d+(?:[.,]\d+)?)\b|\b(\d+(?:[.,]\d+)?)\s*(?:bars?|b)\b/.exec(foldText(article.designation ?? ""))?.slice(1).find(Boolean)?.replace(",", ".") ?? null;
}

export function referenceConnection(article: ProductReferenceIdentity) {
  const text = foldText([article.material, article.designation].filter(Boolean).join(" "));
  if (/\bsans\s+soudure\b/.test(text)) return "SS";
  if (/\bsert/.test(text)) return "ST";
  if (/\b(?:soude(?:e|es|s)?|soudure|souder)\b/.test(text)) return "SD";
  if (/\b(?:a brides?|bridees?)\b/.test(text)) return "BR";
  return /\b(ff|mf|mm)\b/.exec(text)?.[1]?.toUpperCase() ?? null;
}

export function referenceThickness(article: ProductReferenceIdentity) {
  const [primary, secondary] = article.dimensions?.split("—") ?? [];
  const precision = (secondary ?? (referenceFamily(article) === "tube" ? primary : null))?.trim() ?? "";
  return /^\d+(?:[.,]\d+)?\s*[x×]\s*(\d+(?:[.,]\d+)?)$/i.exec(precision)?.[1]?.replace(",", ".") ?? null;
}

export function referenceValveType(article: ProductReferenceIdentity) {
  if (referenceFamily(article) === "vanne") {
    const text = foldText([article.product_type, article.designation].filter(Boolean).join(" "));
    const valve = /\b(papillon|boisseau|spherique|equilibrage|guillotine|opercule)\b/.exec(text)?.[1];
    return valve === "boisseau" || valve === "spherique" ? "boisseau" : valve ?? null;
  }
  return null;
}

function referenceGeneralType(article: ProductReferenceIdentity) {
  const family = referenceFamily(article);
  if (family) return family;
  for (const value of [article.product_type, article.designation]) {
    const match = /^(bride|contre-bride|manchon|bouchon|clapet|collier|raccord|adaptateur|te|flexible|filtre|pompe|joint|purgeur|thermometre|manometre|support|collet)\b/.exec(foldText(value ?? "").trim());
    if (match && match[1] !== "raccord") return match[1];
  }
  return null;
}

const identitySignals: ReadonlyArray<readonly [string, (input: ProductReferenceIdentity) => string | null]> = [
  ["Type d’article", referenceGeneralType], ["Variante d’article", referenceValveType],
  ["Matière", referenceMaterial], ["Nuance", referenceGrade], ["Angle", referenceAngle],
  ["Pression", referencePressure], ["Raccordement", referenceConnection], ["Épaisseur", referenceThickness],
];

export function productReferenceEvidenceKey(article: ProductReferenceIdentity) {
  return JSON.stringify([referenceSize(article), ...identitySignals.map(([, read]) => read(article))]);
}

export function hasProductReferenceAgreement(left: ProductReferenceIdentity, right: ProductReferenceIdentity) {
  if (compareSizes(referenceSize(left), referenceSize(right)) === "same") return true;
  return identitySignals.filter(([, read]) => {
    const known = read(left);
    return known !== null && known === read(right);
  }).length >= 2;
}

/** Only explicit technical disagreements count. A missing field is not evidence of a different product. */
export function productReferenceConflicts(left: ProductReferenceIdentity, right: ProductReferenceIdentity): string[] {
  const differences = identitySignals.flatMap(([field, read]) => {
    const first = read(left);
    const second = read(right);
    return first && second && first !== second ? [field] : [];
  });
  if (compareSizes(referenceSize(left), referenceSize(right)) === "different") differences.unshift("Dimensions");
  return differences;
}
