import { z } from "zod";

import { foldText } from "@/lib/text/fold";

import {
  REFERENCE_FAMILIES, referenceAngle, referenceConnection, referenceFamily, referenceGrade, referenceMaterial,
  referencePressure, referenceSize, referenceThickness, referenceValveType,
  type ProductReferenceIdentity, type ReferenceFamily,
} from "./product-reference-identity";

const TOKENS = ["matiere", "dimension", "variante", "angle", "pression", "epaisseur"] as const;
export type ReferenceToken = (typeof TOKENS)[number];

const tokenPattern = new RegExp(`^\\{(${TOKENS.join("|")})\\}$`);
const literalPattern = /^[A-Z0-9]{1,16}$/;
/** A spreadsheet drops the leading zeros of a code made of digits: a format starts with a letter. */
const prefixPattern = /^[A-Z][A-Z0-9]{0,15}$/;
const MAX_REFERENCE_LENGTH = 80;

export const REFERENCE_ABBREVIATION_GROUPS = [
  { key: "matiere", label: "Matières" },
  { key: "raccordement", label: "Raccordements" },
  { key: "vanne", label: "Types de vanne" },
] as const;
type AbbreviationGroup = (typeof REFERENCE_ABBREVIATION_GROUPS)[number]["key"];

/**
 * The words a reference can abbreviate, with the code used while the company chose none. A material's key is
 * the word `referenceMaterial` reads; a connection's default code is the one `referenceConnection` returns.
 */
export const REFERENCE_ABBREVIATION_TERMS = [
  { key: "inox", group: "matiere", label: "Inox", code: "INOX" },
  { key: "acier", group: "matiere", label: "Acier", code: "ACIER" },
  { key: "cuivre", group: "matiere", label: "Cuivre", code: "CUIVRE" },
  { key: "multicouche", group: "matiere", label: "Multicouche", code: "MULTICOUCHE" },
  { key: "pvc", group: "matiere", label: "PVC", code: "PVC" },
  { key: "pehd", group: "matiere", label: "PEHD", code: "PEHD" },
  { key: "fonte", group: "matiere", label: "Fonte", code: "FONTE" },
  { key: "per", group: "matiere", label: "PER", code: "PER" },
  { key: "ppr", group: "matiere", label: "PPR", code: "PPR" },
  { key: "laiton", group: "matiere", label: "Laiton", code: "LAITON" },
  { key: "sans_soudure", group: "raccordement", label: "Sans soudure", code: "SS" },
  { key: "serti", group: "raccordement", label: "Serti", code: "ST" },
  { key: "soude", group: "raccordement", label: "Soudé", code: "SD" },
  { key: "brides", group: "raccordement", label: "À brides", code: "BR" },
  { key: "ff", group: "raccordement", label: "Femelle-femelle", code: "FF" },
  { key: "mf", group: "raccordement", label: "Mâle-femelle", code: "MF" },
  { key: "mm", group: "raccordement", label: "Mâle-mâle", code: "MM" },
  { key: "equilibrage", group: "vanne", label: "Équilibrage", code: "EQ" },
  { key: "papillon", group: "vanne", label: "Papillon", code: "PAP" },
  { key: "boisseau", group: "vanne", label: "Boisseau sphérique", code: "BS" },
  { key: "guillotine", group: "vanne", label: "Guillotine", code: "GUI" },
  { key: "opercule", group: "vanne", label: "Opercule", code: "OP" },
  { key: "arret", group: "vanne", label: "Arrêt", code: "AR" },
] as const satisfies ReadonlyArray<{ key: string; group: AbbreviationGroup; label: string; code: string }>;

const termByKey = new Map<string, (typeof REFERENCE_ABBREVIATION_TERMS)[number]>(
  REFERENCE_ABBREVIATION_TERMS.map((term) => [term.key, term]),
);
const connectionKeyByCode = new Map<string, string>(
  REFERENCE_ABBREVIATION_TERMS.filter((term) => term.group === "raccordement").map((term) => [term.code, term.key]),
);

const ruleSchema = z.string().trim().min(1).max(100).refine((pattern) => {
  const parts = pattern.split("-");
  return prefixPattern.test(parts[0] ?? "") && parts.includes("{dimension}")
    && parts.every((part) => literalPattern.test(part) || tokenPattern.test(part));
}, "Commencez par un préfixe en majuscules qui débute par une lettre, gardez {dimension} et séparez les champs proposés par des tirets.");

const abbreviationsSchema = z.record(z.string(), z.string().regex(literalPattern, "Une abréviation compte 1 à 16 lettres majuscules ou chiffres, sans tiret."))
  .superRefine((abbreviations, context) => {
    for (const key of Object.keys(abbreviations)) {
      if (!termByKey.has(key)) context.addIssue({ code: "custom", path: [key], message: "Ce terme n’a pas d’abréviation réglable." });
    }
    // Two words sharing one code inside a group would give two different articles the same reference.
    for (const group of REFERENCE_ABBREVIATION_GROUPS) {
      const seen = new Map<string, string>();
      for (const term of REFERENCE_ABBREVIATION_TERMS) {
        if (term.group !== group.key) continue;
        const code = abbreviations[term.key] ?? term.code;
        const other = seen.get(code);
        if (other) {
          context.addIssue({ code: "custom", path: [term.key], message: `« ${term.label} » et « ${other} » portent la même abréviation ${code}.` });
        }
        seen.set(code, term.label);
      }
    }
  });

export const productReferenceNamingSchema = z.object({
  enabled: z.boolean(),
  patterns: z.object({ tube: ruleSchema, coude: ruleSchema, reduction: ruleSchema, vanne: ruleSchema }).strict(),
  abbreviations: abbreviationsSchema.optional(),
}).strict();
export type ProductReferenceNaming = z.infer<typeof productReferenceNamingSchema>;

export const DEFAULT_PRODUCT_REFERENCE_PATTERNS: ProductReferenceNaming["patterns"] = {
  tube: "TUB-{matiere}-{dimension}-{variante}-{epaisseur}",
  coude: "COU-{angle}-{matiere}-{dimension}-{variante}",
  reduction: "RED-{matiere}-{dimension}-{variante}",
  vanne: "VAN-{variante}-{dimension}-{pression}",
};

/** What a company that saved nothing has: the default formats, switched off until its administrator turns them on. */
export const UNSAVED_PRODUCT_REFERENCE_NAMING: ProductReferenceNaming = {
  enabled: false,
  patterns: DEFAULT_PRODUCT_REFERENCE_PATTERNS,
};

export const REFERENCE_FAMILY_LABELS: Record<ReferenceFamily, string> = {
  tube: "Tubes", coude: "Coudes", reduction: "Réductions", vanne: "Vannes",
};

export const REFERENCE_TOKEN_LABELS: Record<ReferenceToken, string> = {
  matiere: "la matière", dimension: "la dimension", variante: "la variante", angle: "l’angle",
  pression: "la pression (PN)", epaisseur: "l’épaisseur",
};

export const REFERENCE_NAMING_EXAMPLES: Record<ReferenceFamily, ProductReferenceIdentity> = {
  tube: { designation: "Tube Inox 316L soudé", material: "Inox 316L soudé", dimensions: "DN50 — 60,3x2" },
  coude: { designation: "Coude 90° inox soudé", material: "Inox 316L soudé", dimensions: "DN50" },
  reduction: { designation: "Réduction inox soudée", material: "Inox 304L soudé", dimensions: "DN50>40" },
  vanne: { designation: "Vanne d’équilibrage FF PN25", dimensions: "DN50" },
};

/** Keeps the choices that differ from the default codes; nothing when none does, as a company that chose none. */
export function compactReferenceAbbreviations(abbreviations: Record<string, string> | undefined) {
  const chosen = Object.entries(abbreviations ?? {}).filter(([key, code]) => termByKey.get(key)?.code !== code);
  return chosen.length > 0 ? Object.fromEntries(chosen) : undefined;
}

export type ProductReferenceProposal = {
  /** Null when the article belongs to no family with a format: it keeps the automatic number. */
  family: ReferenceFamily | null;
  reference: string | null;
  /** Fields of the format the article does not state: completing them gives a reference. */
  missing: ReferenceToken[];
};

/**
 * The reference the company's format gives an article, or what the article lacks to get one. A measurable
 * characteristic the format names (dimension, material, angle, pressure, thickness) must be known: a reference
 * shortened by a missing one would read as another article. A variant is a qualifier some articles do not have.
 */
export function explainProductReference(rule: ProductReferenceNaming, article: ProductReferenceIdentity): ProductReferenceProposal {
  const family = referenceFamily(article);
  if (!rule.enabled || !family) return { family, reference: null, missing: [] };
  const code = (key: string | null | undefined) => {
    const term = key ? termByKey.get(key) : undefined;
    return term ? rule.abbreviations?.[term.key] ?? term.code : null;
  };
  const size = referenceSize(article);
  const pair = (primary: number, secondary: number | null) => `${primary}${secondary === null ? "" : `X${secondary}`}`;
  // A reduction names both of its ends. Sizes given by outside diameter keep that notation even when a DN can be inferred.
  const dimension = !size || (family === "reduction" && size.reduce === null && size.reduceOd === null) ? null
    : size.metric !== null ? `M${size.metric}`
    : size.od !== null ? `D${pair(size.od, size.reduceOd)}`
    : size.dn !== null ? `DN${pair(size.dn, size.reduce)}` : null;
  const valveType = referenceValveType(article);
  const valve = family !== "vanne" ? null
    : code(valveType ?? (/\barret\b/.test(foldText(article.designation ?? "")) ? "arret" : null));
  const connection = code(connectionKeyByCode.get(referenceConnection(article) ?? ""));
  const thickness = referenceThickness(article);
  const pressure = referencePressure(article);
  const values: Record<ReferenceToken, string | null> = {
    matiere: referenceGrade(article)?.toUpperCase() ?? code(referenceMaterial(article)),
    dimension,
    variante: [valve, connection].filter(Boolean).join("-") || null,
    angle: referenceAngle(article),
    pression: pressure ? `PN${pressure}` : null,
    epaisseur: thickness ? `E${thickness}` : null,
  };
  const parts = rule.patterns[family].split("-").map((part) => (tokenPattern.exec(part)?.[1] as ReferenceToken | undefined) ?? part);
  const isToken = (part: string): part is ReferenceToken => (TOKENS as readonly string[]).includes(part);
  const missing = [...new Set(parts.filter(isToken).filter((token) => token !== "variante" && values[token] === null))];
  if (missing.length > 0) return { family, reference: null, missing };
  const reference = parts.flatMap((part) => (isToken(part) ? values[part] ?? [] : part)).join("-");
  return { family, reference: reference.length <= MAX_REFERENCE_LENGTH ? reference : null, missing: [] };
}

export function proposeProductReference(rule: ProductReferenceNaming, article: ProductReferenceIdentity): string | null {
  return explainProductReference(rule, article).reference;
}

export { REFERENCE_FAMILIES };
