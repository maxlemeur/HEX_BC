import { DIAMETER_FAMILIES, findDiameterEntries, type DiameterFamily } from "@/lib/takeoff/bench/diameters";
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

export const NETWORK_DIAMETER_TABLE_VERSION = 2;

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

function familiesOf(material: MaterialCode): DiameterFamily[] {
  return (Object.keys(DIAMETER_FAMILIES) as DiameterFamily[]).filter((family) => DIAMETER_FAMILIES[family].materials.includes(material));
}

export type NetworkDiameterCheck =
  | { status: "compatible" }
  | { status: "requires_justification"; reason: string }
  | { status: "blocked"; reason: string }
  | { status: "material_missing" | "dn_missing" }
  | { status: "material_not_allowed"; allowed: readonly MaterialCode[] }
  | { status: "dn_not_in_series"; families: DiameterFamily[] };

/** The triplet's place in the table: compatible, or why it fails. Insulation and trace heating are never passed here. */
export function checkNetworkDiameter(network: NetworkCode, material: MaterialCode | null, dn: string | null): NetworkDiameterCheck {
  if (material === null) return { status: "material_missing" };
  if (network === "GAZ" && material === "multicouche") return { status: "blocked", reason: "Multicouche en gaz : validation interdite ; seul un administrateur peut forcer avec une réserve ou une variante." };
  const condition = conditionOf(network, material);
  const allowed = NETWORK_MATERIALS[network];
  if (!condition && !allowed.includes(material)) return { status: "material_not_allowed", allowed };
  if (dn === null || dn.trim() === "") return { status: "dn_missing" };
  const families: DiameterFamily[] = STAINLESS.includes(material) && DRAINAGE_NETWORKS.includes(network)
    ? ["inox-evacuation"] : familiesOf(material).filter((family) => family !== "inox-evacuation");
  // findDiameterEntries restricts to the material's series; a material without series would read every series.
  if (families.length === 0) return { status: "dn_not_in_series", families };
  const restricted = PVC_SERIES[material];
  const entries = findDiameterEntries(dn, material, families).filter((entry) => !restricted || restricted.includes(entry.od_mm));
  if (entries.length === 0) return { status: "dn_not_in_series", families };
  return condition ? { status: "requires_justification", reason: condition } : { status: "compatible" };
}

/** Every network of the vocabulary has a row: a code added to keys.ts without one fails the type check above. */
export const NETWORKS_WITHOUT_MATERIALS = NETWORK_CODES.filter((code) => NETWORK_MATERIALS[code].length === 0);
