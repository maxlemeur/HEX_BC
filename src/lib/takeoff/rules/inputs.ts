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
//   room. An unknown DN (« DN 23 ») is kept as printed, so that the DN rule
//   fails it; two DN or two networks give no triplet (the rule does not read
//   the line).
// - Non-observable quantities: a plan view never shows a weld, a tap, a
//   support, a vertical run, a transport or a service (bench PLAN_CAUSES,
//   keys.ts). A line naming one is a quantity to be entered, never one the
//   model may propose; the vocabulary below is generic trade words only.

export const TAKEOFF_RULE_INPUTS_VERSION = 1;

const NON_OBSERVABLE_PATTERNS: ReadonlyArray<{ cause: NonObservableCause; pattern: RegExp }> = [
  { cause: "weld", pattern: /\bsoudures?\b|\bbrasures?\b/i },
  { cause: "tap", pattern: /\bpiquages?\b/i },
  { cause: "support", pattern: /\bsupports?\b|\bsupportages?\b|\bcolliers?\b|\bsuspentes?\b|\bconsoles?\b/i },
  { cause: "vertical", pattern: /\bchutes?\b|\bcolonnes?\s+montantes?\b|\bremont[ée]es?\b|\bverticale?s?\b|\bdescentes?\b/i },
  { cause: "transport", pattern: /\btransports?\b|\bmanutentions?\b|\blevages?\b|\bacheminements?\b/i },
  { cause: "install_only", pattern: /\bpose\s+seule\b|\bfourniture\s+seule\b|\bmain[- ]d['’]?\s*[œo]e?uvre\b/i },
  {
    cause: "service",
    pattern: /\bmises?\s+en\s+service\b|\bessais?\b|\brin[cç]ages?\b|\bd[ée]sinfections?\b|\b[ée]preuves?\b|\bDOE\b|\b[ée]tiquetages?\b|\brep[ée]rages?\b|\bnettoyages?\b|\b[ée]tudes?\b|\bplans?\s+d['’]ex[ée]cution\b/i,
  },
];

function stripAccents(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** The cause a designation names, in pattern order (a weld before a support), or null. */
export function nonObservableCause(designation: string): NonObservableCause | null {
  const text = designation.replace(/\s+/g, " ");
  const plain = stripAccents(text);
  for (const { cause, pattern } of NON_OBSERVABLE_PATTERNS) {
    if (pattern.test(text) || pattern.test(plain)) return cause;
  }
  return null;
}

export type DesignationLine = { designation: string; category?: string | null; evidence?: string | null; unit: string; quantity: number };

/** Organs a weld, tap or support cause may name: any other organ read is the line's object, drawn on the plan. */
const COUNTED_WORKS = new Set(["soudure", "piquage", "support"]);

/**
 * Inputs of a line the model proposed (levels B and C): read in its text, never in its quantity. A weld, tap or
 * support word makes a line non-observable only when no other organ is its object (« Vanne avec support » is a
 * valve); a vertical word only a length (« Vanne de colonne montante » is a valve).
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
  const organ = key.kind === "count" ? key.organ : null;
  if ((cause === "weld" || cause === "tap" || cause === "support") && organ !== null && !COUNTED_WORKS.has(organ)) {
    base.non_observable = null;
  }
  if (cause === "vertical" && key.kind !== "network") base.non_observable = null;
  if (key.kind === "count") return { ...base, kind: "count" };
  if (key.kind === "surface") return { ...base, kind: "surface" };
  // A length (or an insulation surface priced in m2): its triplet as read, the DN as printed. A triplet the reader
  // could not complete stays incomplete (« Triplet absent : échec »): no network or two, two DN, an unknown DN.
  const material = key.material;
  const kind = material === "calorifuge" || material === "cordon-chauffant" ? "insulation" : "network";
  const reason = reading.status === "unreadable" ? reading.reason : null;
  const network = reason === "network_missing" || reason === "network_ambiguous" ? null : key.network;
  const dn = reason === "dn_unknown" ? unknownDnText(line.designation) : reason === "dn_ambiguous" ? null : key.dn?.printed ?? null;
  return { ...base, kind, network, material, dn };
}

/** The « DN n » of a designation whose size no series has (the reader keeps none): the DN rule fails it. */
function unknownDnText(designation: string) {
  const match = /\bDN\s*-?\s*(\d+(?:[.,]\d+)?)\b/i.exec(designation);
  return match ? `DN ${match[1].replace(",", ".")}` : null;
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
