import { DIAMETER_FAMILIES, findDiameterEntries, type DiameterEntry, type DiameterFamily } from "@/lib/takeoff/bench/diameters";
import { NETWORK_CODES, type MaterialCode, type NetworkCode } from "@/lib/takeoff/bench/keys";

// DN × network reference of the fixed rules (TI-664 step 1), extending the
// diameter table of L0 (bench/diameters.ts, TI-659 §8). Per network of the
// legend: the materials a network may be built in, and for each material the
// series of its product standard (copper NF EN 1057, press stainless NF EN
// 10312, welded stainless ISO 1127, PVC NF EN 1329-1 / 1452, SMU cast iron NF
// EN 877, steel NF EN 10255 / 10220, multilayer ISO 21003, PE-X ISO 15875,
// PE NF EN 12201, PP NF EN 1451 / ISO 15874). Generic trade usage only, never a
// devis nor a client plan. A triplet (network, material, DN) the table does not
// hold fails: a missing material or DN, a material the network does not take,
// or a DN its material's series does not have.
// - The DN is read as printed (« DN 22 » for a 22 mm press stainless or copper
//   tube, « 22x1,2 », « Ø 22 », « 20/22 ») through findDiameterEntries, which
//   resolves outer diameters, nominal DN and their aliases (diameters.ts).
// - A supply or return network (CHW-S, HW-R…) takes its parent's materials; a
//   network without its own row is no network of the table.
// - Insulation and trace heating wrap a pipe: they have no series of their
//   own, the rule does not read them.
// - The series of a material is the whole series of its standard: a network
//   restricts the materials, never the sizes. PVC drainage (NF EN 1329-1) and
//   PVC pressure (NF EN 1452) share one family of the L0 table: their outer
//   diameters are told apart here (PVC_SERIES). Cases left to Max
//   (AMBIGUOUS_NETWORK_MATERIALS) stay as written here until he decides.
// - Stainless is read in the series of its network (diameterFamiliesFor), by
//   this rule, the duplicate detection, the DPGF identity and the designation
//   reader alike (TI-684, D18c).
// - A missing or out-of-series DN keeps the couple's condition (D18b): the
//   reviewer sees what the material needs beside the DN to fix.
// - The size key of a line is its material, outer diameter, wall and printed
//   text; the nominal DN is derived from them (TI-683, Q7 and D7). A printed
//   size is never rewritten: it resolves to one tube of the series retained
//   (resolveNetworkSize), or to several when a « DN n » names both a tube
//   printed by its outer diameter and another by its nominal DN (copper
//   « DN 15 »: Ø 15 or Ø 18; pressure stainless « DN 100 »: Ø 108 press-fit or
//   Ø 114,3 welded). An ambiguous size fails as a DN not read, with its
//   candidates: nobody chooses a tube in the reviewer's place.
// - PE and PP are told apart by usage like PVC (D7): their drainage sizes on a
//   gravity network, their pressure sizes on a pressure one, both on
//   condensates and on a line whose network was not read (USAGE_SERIES).

// v3 (TI-684, TI-685 D18a/D18b): stainless condensates read the drainage series too, and a DN failure now shows the
// couple's condition, which a line verified under v2 was accepted without. The version is part of every failure key
// (failure-keys.ts), so v3 changes every dn_network key: the next recomputation of a version reopens every verified
// line of its completed, non-applied jobs that carries a failing dn_network result, whatever its code, and admin
// overrides recorded under v2 keys no longer match at apply. Applied jobs stay frozen with their results (recompute
// never rewrites them). Unlike v2, no migration marks completed jobs stale: they keep v2 results until recomputed.
// v4 (TI-683): an ambiguous « DN n » fails where it passed, PE and PP are read in the sizes of their usage, and the
// PVC sizes restrict every reading (rule, duplicates, DPGF identity, designation reader), no longer the rule alone. As
// for v3, every dn_network key changes and no migration marks completed jobs stale.
export const NETWORK_DIAMETER_TABLE_VERSION = 4;

const STAINLESS: readonly MaterialCode[] = ["inox", "inox-304l", "inox-316l"];
const STEEL: readonly MaterialCode[] = ["acier", "acier-noir"];

/** Sanitary cold water: every drinking-water material, PVC pressure, galvanised steel and PE included. */
const COLD_WATER: readonly MaterialCode[] = ["cuivre", ...STAINLESS, "multicouche", "per", "pp", "pvc-pression", "acier-galvanise", "pehd"];
/** Sanitary hot water and its return loop: no PVC-U, galvanised steel nor PE (temperature). */
const HOT_WATER: readonly MaterialCode[] = ["cuivre", ...STAINLESS, "multicouche", "per", "pp"];
/** Gravity drainage: PVC, SMU cast iron, PP and PE drainage pipes, stainless drainage (NF EN 1124, kitchens). */
const DRAINAGE: readonly MaterialCode[] = ["pvc", "fonte", "pp", "pehd", ...STAINLESS];
/** Closed hydronic loops (chilled, heating, heat recovery, condenser water). */
const HYDRONIC: readonly MaterialCode[] = [...STEEL, ...STAINLESS, "cuivre", "multicouche", "pp"];
/** Glycol: no zinc (galvanised steel reacts with the inhibitors). */
const GLYCOL: readonly MaterialCode[] = [...STEEL, ...STAINLESS, "cuivre", "pp", "pehd"];
/** Fire networks: steel series only (NF S 61-750 dry risers, NF EN 671 hose reels, NF EN 12845 sprinklers). */
const FIRE: readonly MaterialCode[] = ["acier-galvanise", ...STEEL];
/** Gas: copper, steel and PE (buried). */
const GAS: readonly MaterialCode[] = ["cuivre", ...STEEL, "pehd"];

export const NETWORK_MATERIALS: Record<NetworkCode, readonly MaterialCode[]> = {
  EF: COLD_WATER,
  EFA: COLD_WATER,
  ECS: HOT_WATER,
  RECS: HOT_WATER,
  EU: DRAINAGE,
  EV: DRAINAGE,
  EUV: DRAINAGE,
  EUG: DRAINAGE,
  EP: DRAINAGE,
  VP: DRAINAGE,
  COND: ["pvc", "pvc-pression", "pp", "pehd", ...STAINLESS],
  CS: FIRE,
  RIA: FIRE,
  SPK: FIRE,
  GAZ: GAS,
  CHW: [...HYDRONIC, "pehd"],
  "CHW-S": [...HYDRONIC, "pehd"],
  "CHW-R": [...HYDRONIC, "pehd"],
  HW: [...HYDRONIC, "per"],
  "HW-S": [...HYDRONIC, "per"],
  "HW-R": [...HYDRONIC, "per"],
  GLY: GLYCOL,
  "GLY-S": GLYCOL,
  "GLY-R": GLYCOL,
  HRC: HYDRONIC,
  "HRC-S": HYDRONIC,
  "HRC-R": HYDRONIC,
  CW: [...HYDRONIC, "pehd"],
  "CW-S": [...HYDRONIC, "pehd"],
  "CW-R": [...HYDRONIC, "pehd"],
};

/** Open evidence only, never treated as permission by the evaluator. */
export const AMBIGUOUS_NETWORK_MATERIALS = [
  { network: "EU", material: "inox", note: "Série NF EN 1124 provisoire : second fabricant et DN 90 à recouper." },
] as const;

const DRAINAGE_NETWORKS: readonly NetworkCode[] = ["EU", "EV", "EUV", "EUG", "EP", "VP"];

/** A condition belongs to the whole network/material family, not just its generic spelling. */
function conditionOf(network: NetworkCode, material: MaterialCode): string | null {
  if (network === "GAZ" && material === "pehd") return "PE gaz : enterré à l’extérieur hors emprise, ou remontée en façade jusqu’au raccord métal/plastique.";
  if (DRAINAGE_NETWORKS.includes(network) && STAINLESS.includes(material)) return "Inox d’évacuation NF EN 1124 : gamme et série à justifier (table provisoire).";
  if (network === "EUG" && material === "pvc") return "Eaux grasses : justifier un système PVC-C ou haute température.";
  if ((network === "EF" || network === "EFA") && material === "acier-galvanise") return "Certification NF, analyse d’eau et absence de cuivre en amont à justifier.";
  if ((network === "EF" || network === "EFA") && material === "pehd") return "Gamme eau potable et pose intérieure à justifier.";
  if (network === "COND" && material === "cuivre") return "Justifier des condensats de climatisation.";
  if (network === "RIA" && material === "pehd") return "Système PEHD pour RIA à justifier ; matériaux admis à vérifier.";
  if (["GLY", "GLY-S", "GLY-R"].includes(network) && material === "multicouche") return "Gamme antigel et pourcentage de glycol à justifier.";
  return null;
}

/** Materials that wrap a pipe: no series of their own, not read by the DN rule. */
export const WRAPPING_MATERIALS: readonly MaterialCode[] = ["calorifuge", "cordon-chauffant"];

/** Outer diameters of each PVC standard (the L0 family holds both). */
export const PVC_SERIES: Partial<Record<MaterialCode, readonly number[]>> = {
  pvc: [32, 40, 50, 63, 75, 80, 90, 100, 110, 125, 140, 160, 200, 250, 315],
  "pvc-pression": [16, 20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 140, 160, 200, 250, 315],
};

/**
 * Outer diameters of PE and PP by usage (TI-683, D7), among those of their L0 family: no size is added here.
 * - PE: pressure NF EN 12201, drainage NF EN 1519 (from Ø 32; no Ø 20, 25 nor 140).
 * - PP: pressure NF EN ISO 15874 (PP-R), drainage NF EN 1451 (from Ø 32; no Ø 16, 20 nor 25).
 * Open for the trade: the drainage Ø 56 of PE, common in manufacturers' ranges and absent from the L0 family, stays out
 * of series until a source is recorded.
 */
export const USAGE_SERIES: Partial<Record<MaterialCode, { pressure: readonly number[]; drainage: readonly number[] }>> = {
  pehd: {
    pressure: [20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 140, 160, 200, 250, 315],
    drainage: [32, 40, 50, 63, 75, 90, 110, 125, 160, 200, 250, 315],
  },
  pp: {
    pressure: [16, 20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160],
    drainage: [32, 40, 50, 63, 75, 90, 110, 125, 160],
  },
};

/**
 * The outer diameters a material is restricted to on a network, or null when its whole family is read:
 * - PVC by its material code, drainage or pressure, whatever the network (PVC_SERIES);
 * - PE and PP by the network's usage: drainage sizes on a gravity network, pressure sizes on any other; both on
 *   condensates (pumped or gravity, as stainless: D18a) and on a line whose network was not read.
 */
export function usageSeriesFor(network: NetworkCode | null, material: MaterialCode): readonly number[] | null {
  const pvc = PVC_SERIES[material];
  if (pvc) return pvc;
  const usage = USAGE_SERIES[material];
  if (!usage || network === null || network === "COND") return null;
  return DRAINAGE_NETWORKS.includes(network) ? usage.drainage : usage.pressure;
}

function familiesOf(material: MaterialCode): DiameterFamily[] {
  return (Object.keys(DIAMETER_FAMILIES) as DiameterFamily[]).filter((family) => DIAMETER_FAMILIES[family].materials.includes(material));
}

/**
 * Series a material is read in on a network, one selection for the DN rule, the duplicate detection, the DPGF
 * identity and the sizes the designation reader keeps (inputs.ts), so that one pipe names one size everywhere
 * (TI-684, D18c):
 * - stainless on a drainage network: the provisional drainage series only (NF EN 1124), never a pressure one
 *   (« DN 100 » is the 110 mm drainage pipe there, not the 108 mm press-fit tube);
 * - stainless condensates (D18a): the pressure and drainage series together, a condensate line being pumped or gravity;
 * - anywhere else, or with no network read: the material's series, drainage stainless left out (it is opt-in by network).
 * A material without a series of its own (an insulation) has none.
 */
export function diameterFamiliesFor(network: NetworkCode | null, material: MaterialCode): DiameterFamily[] {
  if (network !== null && STAINLESS.includes(material) && DRAINAGE_NETWORKS.includes(network)) return ["inox-evacuation"];
  return familiesOf(material).filter((family) => family !== "inox-evacuation" || network === "COND");
}

/**
 * Entries a DN names on a network, through diameterFamiliesFor and the sizes of the material's usage (usageSeriesFor).
 * A line without a material, or whose material has no series (an insulation), follows findDiameterEntries: every
 * series but drainage stainless.
 */
export function findNetworkDiameterEntries(dn: string, network: NetworkCode | null, material: MaterialCode | null): DiameterEntry[] {
  const families = material ? diameterFamiliesFor(network, material) : [];
  const entries = findDiameterEntries(dn, material, families.length > 0 ? families : undefined);
  const restricted = material ? usageSeriesFor(network, material) : null;
  const read = restricted ? entries.filter((entry) => restricted.includes(entry.od_mm)) : entries;
  // An outer diameter names the tube of exactly that diameter before one a rounding reaches: a stainless « Ø 42 » is
  // the press-fit tube, never the welded Ø 42,4. Here, so that every reader of a size makes the same choice.
  const outer = printedOuter(dn);
  const exact = read.filter((entry) => entry.od_mm === outer);
  return new Set(exact.map((entry) => entry.od_mm)).size === 1 ? exact : read;
}

/** The outer diameter a size prints (« Ø 42 », « 42x1,5 », « 42 mm »), or null for a « DN n », which prints a nominal size. */
function printedOuter(dn: string) {
  if (/\bdn\s*-?\s*\d/i.test(dn)) return null;
  const outer = /(?<![\d.,])(\d+(?:[.,]\d+)?)/.exec(dn);
  return outer ? Number(outer[1].replace(",", ".")) : null;
}

/** One tube a size may be: an outer diameter of the series retained, with the nominal DN its entries agree on. */
export type SizeCandidate = { families: DiameterFamily[]; od_mm: number; nominal_dn: number | null };

/**
 * The tube a printed size resolves to (TI-683, Q7): the key is the material with this outer diameter, wall and
 * printed text, the nominal DN is derived.
 */
export type ResolvedSize = SizeCandidate & {
  /** The size as printed on the plan or in the designation, never rewritten. */
  printed: string;
  /** The wall the text prints (« 22x1,2 »), else the usual wall of the series when its entries agree on one. */
  wall_mm: number | null;
  wall_source: "printed" | "series" | null;
};

export type SizeResolution =
  | { status: "resolved"; size: ResolvedSize }
  | { status: "ambiguous"; candidates: SizeCandidate[] }
  | { status: "unknown" };

function agreed(values: ReadonlyArray<number | null>) {
  const distinct = new Set(values);
  return distinct.size === 1 ? values[0] : null;
}

/** The wall a size prints (« 22x1,2 », « 22 x 1.5 »), as findDiameterEntries reads the pair: under a quarter of the outer diameter. */
function printedWall(dn: string) {
  const pair = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/.exec(dn);
  if (!pair) return null;
  const [outer, wall] = [Number(pair[1].replace(",", ".")), Number(pair[2].replace(",", "."))];
  return wall < outer * 0.25 ? wall : null;
}

/**
 * What a printed size names on a network, in the series retained for its material: one tube (one outer diameter,
 * whatever the series that hold it), several (the size is ambiguous, each candidate named), or none (unknown size).
 */
export function resolveNetworkSize(dn: string, network: NetworkCode | null, material: MaterialCode | null): SizeResolution {
  const entries = findNetworkDiameterEntries(dn, network, material);
  if (entries.length === 0) return { status: "unknown" };
  const byOuter = new Map<number, DiameterEntry[]>();
  for (const entry of entries) byOuter.set(entry.od_mm, [...(byOuter.get(entry.od_mm) ?? []), entry]);
  const candidates = [...byOuter].sort(([left], [right]) => left - right).map(([od_mm, held]): SizeCandidate => ({
    families: [...new Set(held.map((entry) => entry.family))], od_mm, nominal_dn: agreed(held.map((entry) => entry.nominal_dn)),
  }));
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  const wall = printedWall(dn);
  const usual = agreed(entries.map((entry) => entry.wall_mm));
  return { status: "resolved", size: { printed: dn.trim(), ...candidates[0], wall_mm: wall ?? usual,
    wall_source: wall !== null ? "printed" : usual !== null ? "series" : null } };
}

export type NetworkDiameterCheck =
  | { status: "compatible"; size: ResolvedSize }
  | { status: "requires_justification"; reason: string; size: ResolvedSize }
  | { status: "blocked"; reason: string }
  | { status: "material_missing" }
  | { status: "dn_missing"; condition?: string }
  /** The printed size names several tubes of the series retained (TI-683): the reviewer names the outer diameter. */
  | { status: "dn_ambiguous"; candidates: SizeCandidate[]; condition?: string }
  | { status: "material_not_allowed"; allowed: readonly MaterialCode[] }
  | { status: "dn_not_in_series"; families: DiameterFamily[]; condition?: string };

/** The triplet's place in the table: compatible, or why it fails. Insulation and trace heating are never passed here. */
export function checkNetworkDiameter(network: NetworkCode, material: MaterialCode | null, dn: string | null): NetworkDiameterCheck {
  if (material === null) return { status: "material_missing" };
  if (network === "GAZ" && material === "multicouche") {
    return { status: "blocked", reason: "Multicouche en gaz : interdit, ne s’accepte pas en relecture. Seul un administrateur peut "
      + "forcer l’application, avec un motif codé et une justification écrite." };
  }
  const condition = conditionOf(network, material);
  const allowed = NETWORK_MATERIALS[network];
  if (!condition && !allowed.includes(material)) return { status: "material_not_allowed", allowed };
  // D18b: a DN failure carries the couple's condition, which the size never lifts.
  const kept = condition ? { condition } : {};
  if (dn === null || dn.trim() === "") return { status: "dn_missing", ...kept };
  const families = diameterFamiliesFor(network, material);
  // findDiameterEntries restricts to the material's series; a material without series would read every series.
  if (families.length === 0) return { status: "dn_not_in_series", families, ...kept };
  const resolved = resolveNetworkSize(dn, network, material);
  if (resolved.status === "unknown") return { status: "dn_not_in_series", families, ...kept };
  if (resolved.status === "ambiguous") return { status: "dn_ambiguous", candidates: resolved.candidates, ...kept };
  return condition ? { status: "requires_justification", reason: condition, size: resolved.size } : { status: "compatible", size: resolved.size };
}

/** Every network of the vocabulary has a row: a code added to keys.ts without one fails the type check above. */
export const NETWORKS_WITHOUT_MATERIALS = NETWORK_CODES.filter((code) => NETWORK_MATERIALS[code].length === 0);
