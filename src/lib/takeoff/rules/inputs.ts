import { readItemKey, unquote } from "@/lib/takeoff/bench/item-keys";
import type { MaterialCode, NetworkCode } from "@/lib/takeoff/bench/keys";
import { findNetworkDiameterEntries, resolveNetworkSize } from "@/lib/takeoff/rules/network-diameters";
import type { NonObservableCause, TakeoffRuleInputs } from "@/lib/takeoff/rules/types";
import { printedSize as printedVectorSize, type SizeNotation } from "@/lib/takeoff/vectors/vocabulary";

// Inputs of the fixed rules for one line (TI-664 step 0), written once by the
// worker and never by the user:
// - a vector line (TI-662) gives its geometry's network, material and size, the
//   size with the notation its plan label prints (« DN 100 », « Ø 110 »:
//   TI-683, D7), never rewritten into one another;
// - any other line (levels B and C, the model's answer) is read in its
//   designation, category and evidence by the bench's deterministic reader
//   (item-keys.ts, the DN through price-reuse-matching.ts and the diameter
//   table): network, material and DN of a length, nothing of a count or a
//   room. Every size the designation prints is checked, whatever the reader
//   kept: an unknown one (« DN 23 », « Ø 23 » beside « DN 22 ») is kept as
//   printed, so that the DN rule fails it; two sizes or two networks give no
//   triplet. Sizes are read in the series the DN rule retains for the network
//   and material read (D18c, network-diameters.ts diameterFamiliesFor):
//   stainless drainage in NF EN 1124 only, stainless condensates in both.
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

// 2 (TI-683): a vector size is written with the notation of its label. A vector size written at version 1 is « DN n »
// whatever the plan printed, and is read either way (sizeReadings); so is a size whose notation is not known today.
export const TAKEOFF_RULE_INPUTS_VERSION = 2;
/** The version of a vector size written without its notation: « DN n », read as a nominal DN or as an outer diameter. */
const VECTOR_SIZE_WITHOUT_NOTATION_VERSION = 1;

/**
 * The texts a line's size is read as: the size as printed, and for a vector size written without its notation
 * (version 1) the outer diameter of the same number too (« DN 110 » of a cast-iron pipe the plan labelled « Ø 110 »).
 * One reading for the DN rule and for the duplicates between zones.
 */
export function sizeReadings(inputs: Pick<TakeoffRuleInputs, "source" | "version" | "dn">): string[] {
  if (inputs.dn === null) return [];
  const withoutNotation = inputs.source === "vector" && inputs.version <= VECTOR_SIZE_WITHOUT_NOTATION_VERSION && inputs.dn.startsWith("DN ");
  return withoutNotation ? [inputs.dn, `Ø ${inputs.dn.slice(3)}`] : [inputs.dn];
}

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

/** The cause the head of a designation opens on, in pattern order, or null; a quoted plan text read unquoted (TI-677). */
export function nonObservableCause(designation: string): NonObservableCause | null {
  const head = designationHead(unquote(designation));
  return NON_OBSERVABLE_PATTERNS.find(({ pattern }) => pattern.test(head))?.cause ?? null;
}

export type DesignationLine = { designation: string; category?: string | null; evidence?: string | null; unit: string; quantity: number };

/**
 * Sizes printed in a designation (« DN 23 », « Ø 23 », « 23 mm », « 22x1,2 », « 3/4" », « 1"1/4 »); a thickness
 * (« ép. 20 mm », « ép. 2,20 mm ») is none. A size never starts inside a number (« 20 mm » of « 2,20 mm »), and an inch
 * size never after a slash or a dot (the 22 of « 20/22" » closes an ID/OD pair, as the reader reads it: TI-677).
 */
const PRINTED_SIZE = /\bDN\s*-?\s*\d+(?:[.,]\d+)?\b|[Øø⌀]\s*\d+(?:[.,]\d+)?|(?<!\d[.,])\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\b|(?<!(?:^|[^A-Za-zÀ-ÿ])[ÉéEe]p(?:aisseur)?\.?\s*)(?<!\d[.,])\b\d+(?:[.,]\d+)?\s*mm\b|(?<![\d./][.,]?)\b\d+\s*(?:"|”)\s*\d\/\d\b|(?<![\d./][.,]?)\b\d+(?:\s*\d\/\d)?\s*(?:"|”|pouces?)|(?<![\d./][.,]?)\b\d\/\d\s*(?:"|”|pouces?)/gi;

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
  // one (« DN 20 / Ø 22 » of a copper tube), kept by the text that names one tube alone (oneTube, TI-683). The series
  // is the one the DN rule retains on the network read (D18c):
  // « EU inox DN 100 / Ø 110 » is one drainage size, « EU inox DN 100 / Ø 108 » keeps the Ø 108 NF EN 1124 lacks.
  const kept = reason === "dn_ambiguous" ? null
    : unknownSize(line.designation, network, material) ?? (severalSizes(line.designation, network, material) ? null
      : key.dn?.printed ?? printedSizes(line.designation)[0] ?? null);
  return { ...base, kind: wrapped ? "insulation" : "network", network, material, dn: oneTube(kept, line.designation, network, material) };
}

/**
 * Sizes printed in a designation, read after the reader drops the quotes around a quoted plan text (unquote): the
 * quote closing « "EF cuivre 20/22" » is the end of the text, never the inch mark of a 22" (TI-677).
 */
function printedSizes(designation: string) {
  return [...unquote(designation).matchAll(PRINTED_SIZE)].map((match) => printedSize(match[0]));
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

/**
 * The first size a designation prints that the material's series on its network lacks (null: every printed size is
 * known). Without a network read, the material's own series (findNetworkDiameterEntries).
 */
function unknownSize(designation: string, network: NetworkCode | null, material: MaterialCode | null) {
  return printedSizes(designation).find((size) => findNetworkDiameterEntries(size, network, material).length === 0) ?? null;
}

/**
 * One size printed two ways names its tube by the text that names one tube alone (TI-683): « EF inox DN 100 / Ø 108 »
 * is the Ø 108 press-fit tube, where « DN 100 » alone is that one or the Ø 114,3 welded one. The size kept stays as it
 * is when it already names one tube (« DN 20 / Ø 22 » of a copper tube), or when no printed size does.
 */
function oneTube(kept: string | null, designation: string, network: NetworkCode | null, material: MaterialCode | null) {
  if (kept === null || resolveNetworkSize(kept, network, material).status !== "ambiguous") return kept;
  return printedSizes(designation).find((size) => resolveNetworkSize(size, network, material).status === "resolved") ?? kept;
}

/** Whether a designation prints two known sizes: two printed sizes with no entry (family and outer diameter) in common. */
function severalSizes(designation: string, network: NetworkCode | null, material: MaterialCode | null) {
  const sizes = printedSizes(designation)
    .map((size) => new Set(findNetworkDiameterEntries(size, network, material).map((entry) => `${entry.family}:${entry.od_mm}`)));
  return sizes.some((left, index) => sizes.slice(index + 1).some((right) => ![...left].some((entry) => right.has(entry))));
}

export type VectorLine = {
  kind: "network" | "insulation" | "surface";
  network: NetworkCode | null;
  material: MaterialCode | null;
  dn: number | null;
  /** The notation the plan label prints the size in; absent or null when it is not known (a reading of before TI-683). */
  notation?: SizeNotation | null;
  quantity: number;
  /** A room: its printed label and printed surface (the page's reading). */
  room?: string | null;
  printed_m2?: number | null;
};

/**
 * Inputs of a vector line (TI-662): its geometry's attributes, the size as the plan label prints it (TI-683). A size
 * without a known notation is written as before, « DN n » at version 1, and read either way.
 */
export function ruleInputsFromVector(line: VectorLine): TakeoffRuleInputs {
  const withoutNotation = line.dn !== null && (line.notation ?? null) === null;
  return {
    version: withoutNotation ? VECTOR_SIZE_WITHOUT_NOTATION_VERSION : TAKEOFF_RULE_INPUTS_VERSION,
    source: "vector", kind: line.kind, network: line.network, material: line.material,
    dn: line.dn === null ? null : printedVectorSize(line.dn, line.notation), non_observable: null, model_quantity: line.quantity,
    ...(line.kind === "surface" ? { room: line.room ?? null, printed_m2: line.printed_m2 ?? null } : {}),
  };
}

/**
 * Inputs of a line the vector reading persists (vectors/persistence.ts): its geometry's attributes; for a room, the
 * label and surface printed in it, carried from its own surface (two rooms alike in label and area keep theirs).
 */
export function ruleInputsFromVectorRecord(record: {
  item: { quantity: number };
  geometry: { kind: VectorLine["kind"]; network: NetworkCode | null; material: MaterialCode | null; dn: number | null; area_m2?: number | null };
  room?: { label: string; printed_m2: number };
  notation?: SizeNotation | null;
}): TakeoffRuleInputs {
  const { item, geometry } = record;
  if (geometry.kind !== "surface") {
    return ruleInputsFromVector({ kind: geometry.kind, network: geometry.network, material: geometry.material, dn: geometry.dn,
      notation: record.notation, quantity: item.quantity });
  }
  return ruleInputsFromVector({ kind: "surface", network: null, material: null, dn: null,
    quantity: record.geometry.area_m2 ?? item.quantity,
    room: record.room?.label ?? null, printed_m2: record.room?.printed_m2 ?? null });
}
