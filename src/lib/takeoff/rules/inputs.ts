import { findDiameterEntries } from "@/lib/takeoff/bench/diameters";
import { readItemKey } from "@/lib/takeoff/bench/item-keys";
import type { MaterialCode, NetworkCode } from "@/lib/takeoff/bench/keys";
import type { NonObservableCause, TakeoffRuleInputs } from "@/lib/takeoff/rules/types";

// Inputs of the fixed rules for one line (TI-664 step 0), written once by the
// worker and never by the user:
// - a vector line (TI-662) gives its geometry's network, material and DN, the
//   DN printed « DN n » as the plan label reads it;
// - any other line (levels B and C, the model's answer) is read in its
//   designation, category and evidence by the bench's deterministic reader
//   (item-keys.ts, the DN through price-reuse-matching.ts and the diameter
//   table): network, material and DN of a length, nothing of a count or a
//   room. Every size the designation prints is checked, whatever the reader
//   kept: an unknown one (« DN 23 », « Ø 23 » beside « DN 22 ») is kept as
//   printed, so that the DN rule fails it; two sizes or two networks give no
//   triplet.
// - Non-observable quantities: a plan view never shows a weld, a tap, a
//   support, a vertical run, a transport or a service (bench PLAN_CAUSES,
//   keys.ts). A line whose head (its text before « y compris », « avec »,
//   « compris », a comma, a semicolon, a parenthesis or a plus, and after a
//   « fourniture et pose de ») opens on one of these words is a quantity to be
//   entered, never one the model may propose. A word further in qualifies the
//   line (« Tube cuivre … y compris supports », « Robinet d'essai », « Vanne
//   avec support »): the line stays what its head names, and an activity the
//   head opens on stays to be entered whatever organ it names after (« Pose
//   seule de vanne », « Transport de pompe »). A vertical word only makes a
//   length non-observable. The vocabulary is generic trade words only.
// - An m2 line read as a network is an insulation surface (keys.ts), never a
//   pipe: the DN rule does not read it.

export const TAKEOFF_RULE_INPUTS_VERSION = 1;

const NON_OBSERVABLE_PATTERNS: ReadonlyArray<{ cause: NonObservableCause; pattern: RegExp }> = [
  { cause: "weld", pattern: /^(?:soudures?|brasures?)\b/i },
  { cause: "tap", pattern: /^piquages?\b/i },
  { cause: "support", pattern: /^(?:supports?|supportages?|colliers?|suspentes?|consoles?)\b/i },
  { cause: "vertical", pattern: /^(?:chutes?|colonnes?\s+montantes?|remontees?|descentes?)\b|^(?:tron[cç]ons?\s+)?(?:verticale?s?|verticaux)\b/i },
  { cause: "transport", pattern: /^(?:transports?|manutentions?|levages?|acheminements?)\b/i },
  { cause: "install_only", pattern: /^(?:pose\s+seule|fourniture\s+seule|main[- ]d['’]?\s*[œo]e?uvre)\b/i },
  {
    cause: "service",
    pattern: /^(?:mises?\s+en\s+service|essais?|rincages?|desinfections?|epreuves?|DOE|etiquetages?|reperages?|nettoyages?|etudes?|plans?\s+d['’]execution)\b/i,
  },
];

function stripAccents(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** The head of a designation: before its qualifiers, after « fourniture et pose de » and its variants. */
export function designationHead(designation: string) {
  const plain = stripAccents(designation).replace(/\s+/g, " ").trim();
  const head = plain.split(/\s+(?:y\s+compris|compris|avec|incluant|inclus)\b|[,;(+]/i)[0] ?? plain;
  return head.replace(/^(?:(?:fourniture|f)\s*(?:et|&)\s*pose|pose(?!\s+seule)|realisation|mise\s+en\s+(?:oeuvre|œuvre))\s+(?:de\s+la\s+|de\s+l['’]\s*|des\s+|du\s+|de\s+|d['’]\s*)?/i, "").trim();
}

/** The cause the head of a designation opens on, in pattern order, or null. */
export function nonObservableCause(designation: string): NonObservableCause | null {
  const head = designationHead(designation);
  return NON_OBSERVABLE_PATTERNS.find(({ pattern }) => pattern.test(head))?.cause ?? null;
}

export type DesignationLine = { designation: string; category?: string | null; evidence?: string | null; unit: string; quantity: number };

/**
 * Sizes printed in a designation (« DN 23 », « Ø 23 », « 23 mm », « 22x1,2 », « 3/4" », « 1"1/4 »); a thickness
 * (« ép. 20 mm », « ép. 2,20 mm ») is none. A size never starts inside a number (« 20 mm » of « 2,20 mm »).
 */
const PRINTED_SIZE = /\bDN\s*-?\s*\d+(?:[.,]\d+)?\b|[Øø⌀]\s*\d+(?:[.,]\d+)?|(?<!\d[.,])\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\b|(?<!(?:^|[^A-Za-zÀ-ÿ])[ÉéEe]p(?:aisseur)?\.?\s*)(?<!\d[.,])\b\d+(?:[.,]\d+)?\s*mm\b|(?<!\d[.,])\b\d+\s*(?:"|”)\s*\d\/\d\b|(?<!\d[.,])\b\d+(?:\s*\d\/\d)?\s*(?:"|”|pouces?)|(?<!\d[.,])\b\d\/\d\s*(?:"|”|pouces?)/gi;

/**
 * Inputs of a line the model proposed (levels B and C): read in its text, never in its quantity.
 */
export function ruleInputsFromDesignation(line: DesignationLine): TakeoffRuleInputs {
  const cause = nonObservableCause(line.designation);
  const base: TakeoffRuleInputs = {
    version: TAKEOFF_RULE_INPUTS_VERSION, source: "designation", kind: null, network: null, material: null, dn: null,
    non_observable: cause, model_quantity: line.quantity,
  };
  const reading = readItemKey(line, { rooms: [] });
  if (reading.status === "out_of_score") return cause === "vertical" ? { ...base, non_observable: null } : base;
  const key = reading.key;
  if (cause === "vertical" && key.kind !== "network") base.non_observable = null;
  if (key.kind === "count") return { ...base, kind: "count" };
  if (key.kind === "surface") return { ...base, kind: "surface" };
  // A length (or an insulation surface priced in m2): its triplet as read, the DN as printed. A triplet the reader
  // could not complete stays incomplete (« Triplet absent : échec »): no network or two, two DN, an unknown size.
  const material = key.material;
  const wrapped = material === "calorifuge" || material === "cordon-chauffant" || key.unit === "m2";
  const reason = reading.status === "unreadable" ? reading.reason : null;
  const network = reason === "network_missing" || reason === "network_ambiguous" ? null : key.network;
  // Every printed size counts, whatever the reader kept (it reads « DN 22 » and skips « Ø 23 » beside it). A size no
  // series has is kept as printed, the first the material's series lacks, never a known one printed beside it
  // (« DN 22 / DN 23 », « DN 22 / Ø 23 »); two known sizes are none (« DN 22 / Ø 28 »); one size printed two ways is
  // one (« DN 20 / Ø 22 » of a copper tube).
  const dn = reason === "dn_ambiguous" ? null
    : unknownSize(line.designation, material) ?? (severalSizes(line.designation, material) ? null
      : key.dn?.printed ?? printedSizes(line.designation)[0] ?? null);
  return { ...base, kind: wrapped ? "insulation" : "network", network, material, dn };
}

function printedSizes(designation: string) {
  return [...designation.matchAll(PRINTED_SIZE)].map((match) => printedSize(match[0]));
}

/** A printed size as the diameter table prints it: « DN 15 », « Ø 22 », « 20 mm » (decimal point), others as printed. */
function printedSize(raw: string) {
  const text = raw.replace(/\s+/g, " ").trim();
  const marked = /^(DN|[Øø⌀])\s*-?\s*(\d+(?:[.,]\d+)?)$/i.exec(text);
  if (marked) return `${/^dn$/i.test(marked[1]) ? "DN" : "Ø"} ${marked[2].replace(",", ".")}`;
  const millimetres = /^(\d+(?:[.,]\d+)?)\s*mm$/i.exec(text);
  if (millimetres) return `${millimetres[1].replace(",", ".")} mm`;
  // « 1"1/4 » is « 1 1/4" ».
  const compound = /^(\d+)\s*["”]\s*(\d\/\d)$/.exec(text);
  return compound ? `${compound[1]} ${compound[2]}"` : text;
}

/** The first size a designation prints that the material's series lacks (null: every printed size is known). */
function unknownSize(designation: string, material: MaterialCode | null) {
  return printedSizes(designation).find((size) => findDiameterEntries(size, material).length === 0) ?? null;
}

/** Whether a designation prints two known sizes: two printed sizes with no entry (family and outer diameter) in common. */
function severalSizes(designation: string, material: MaterialCode | null) {
  const sizes = printedSizes(designation).map((size) => new Set(findDiameterEntries(size, material).map((entry) => `${entry.family}:${entry.od_mm}`)));
  return sizes.some((left, index) => sizes.slice(index + 1).some((right) => ![...left].some((entry) => right.has(entry))));
}

export type VectorLine = {
  kind: "network" | "insulation" | "surface";
  network: NetworkCode | null;
  material: MaterialCode | null;
  dn: number | null;
  quantity: number;
  /** A room: its printed label and printed surface (the page's reading). */
  room?: string | null;
  printed_m2?: number | null;
};

/** Inputs of a vector line (TI-662): its geometry's attributes, the DN as the plan label prints it. */
export function ruleInputsFromVector(line: VectorLine): TakeoffRuleInputs {
  return {
    version: TAKEOFF_RULE_INPUTS_VERSION, source: "vector", kind: line.kind, network: line.network, material: line.material,
    dn: line.dn === null ? null : `DN ${line.dn}`, non_observable: null, model_quantity: line.quantity,
    ...(line.kind === "surface" ? { room: line.room ?? null, printed_m2: line.printed_m2 ?? null } : {}),
  };
}
