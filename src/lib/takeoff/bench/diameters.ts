import type { MaterialCode } from "@/lib/takeoff/bench/keys";

// Versioned diameter correspondence of the takeoff bench (TI-659), from public
// product standards only, no client data. A devis writes « 22x1,2 », a plan
// « DN 22 »: the truth key is the DN printed on the plan. Thin-wall and plastic
// series are printed by their outer diameter (`plan_label: "outer_diameter"`),
// steel, welded stainless and cast iron by their nominal DN. When one text
// matches entries with different outer diameters, the case is ambiguous and goes
// to the reviewer; this module never picks one.

export const DIAMETER_TABLE_VERSION = 1;

export const DN_KEY_PATTERN = /^DN \d+(?:\.\d+)?$/;

export type DiameterFamily =
  | "cuivre"
  | "inox-sertir"
  | "inox-soude"
  | "multicouche"
  | "per"
  | "pvc"
  | "pehd"
  | "pp"
  | "fonte-smu"
  | "acier";

type FamilyInfo = {
  label: string;
  standard: string;
  plan_label: "outer_diameter" | "nominal_dn";
  materials: readonly MaterialCode[];
};

const STAINLESS: readonly MaterialCode[] = ["inox", "inox-304l", "inox-316l"];

export const DIAMETER_FAMILIES: Record<DiameterFamily, FamilyInfo> = {
  cuivre: { label: "Tube cuivre", standard: "NF EN 1057", plan_label: "outer_diameter", materials: ["cuivre"] },
  "inox-sertir": {
    label: "Tube inox à sertir", standard: "NF EN 10312 série 2", plan_label: "outer_diameter", materials: STAINLESS,
  },
  "inox-soude": {
    label: "Tube inox soudé", standard: "NF EN ISO 1127, ISO 6708", plan_label: "nominal_dn", materials: STAINLESS,
  },
  multicouche: { label: "Tube multicouche", standard: "NF EN ISO 21003", plan_label: "outer_diameter", materials: ["multicouche"] },
  per: { label: "Tube PER", standard: "NF EN ISO 15875", plan_label: "outer_diameter", materials: ["per"] },
  pvc: {
    label: "Tube PVC évacuation et pression", standard: "NF EN 1329-1, NF EN 1452",
    plan_label: "outer_diameter", materials: ["pvc", "pvc-pression"],
  },
  pehd: { label: "Tube PEHD", standard: "NF EN 12201", plan_label: "outer_diameter", materials: ["pehd"] },
  pp: { label: "Tube polypropylène", standard: "NF EN 1451, NF EN ISO 15874", plan_label: "outer_diameter", materials: ["pp"] },
  "fonte-smu": { label: "Fonte d'évacuation SMU", standard: "NF EN 877", plan_label: "nominal_dn", materials: ["fonte"] },
  acier: {
    label: "Tube acier", standard: "NF EN 10255 série moyenne, NF EN 10220", plan_label: "nominal_dn",
    materials: ["acier", "acier-noir", "acier-galvanise"],
  },
};

export type DiameterEntry = {
  family: DiameterFamily;
  /** Outer diameter in millimetres. */
  od_mm: number;
  /** Typical wall thickness in millimetres; informative, never used to match. */
  wall_mm: number | null;
  /** Nominal DN (ISO 6708 equivalence) when the standard or its usage gives one. */
  nominal_dn: number | null;
  /** Other spellings: French ID/OD pairs (« 20/22 », « 20/27 ») and inch sizes. */
  aliases: readonly string[];
};

type Row = [od: number, wall: number | null, dn: number | null, ...aliases: string[]];

function series(family: DiameterFamily, rows: readonly Row[]): DiameterEntry[] {
  return rows.map(([od_mm, wall_mm, nominal_dn, ...aliases]) => ({ family, od_mm, wall_mm, nominal_dn, aliases }));
}

function outerDiameters(family: DiameterFamily, values: readonly number[]) {
  return series(family, values.map((od): Row => [od, null, null]));
}

export const DIAMETER_TABLE: readonly DiameterEntry[] = [
  ...series("cuivre", [
    [10, 1, null, "8/10"], [12, 1, 10, "10/12"], [14, 1, null, "12/14"], [15, 1, 12, "13/15"],
    [16, 1, null, "14/16"], [18, 1, 15, "16/18"], [22, 1, 20, "20/22"], [28, 1, 25, "26/28"],
    [32, 1, null, "30/32"], [35, 1, 32, "33/35"], [42, 1, 40, "40/42"], [54, 1, 50, "52/54"],
    [64, 2, null], [76.1, 2, 65], [88.9, 2, 80], [108, 2.5, 100],
  ]),
  ...series("inox-sertir", [
    [15, 1, 12], [18, 1, 15], [22, 1.2, 20], [28, 1.2, 25], [35, 1.5, 32], [42, 1.5, 40],
    [54, 1.5, 50], [76.1, 2, 65], [88.9, 2, 80], [108, 2, 100], [139.7, 2.6, 125], [168.3, 2.6, 150],
  ]),
  ...series("inox-soude", [
    [21.3, null, 15], [26.9, null, 20], [33.7, null, 25], [42.4, null, 32], [48.3, null, 40],
    [60.3, null, 50], [76.1, null, 65], [88.9, null, 80], [114.3, null, 100], [139.7, null, 125],
    [168.3, null, 150], [219.1, null, 200], [273, null, 250], [323.9, null, 300],
  ]),
  ...series("multicouche", [
    [14, 2, null], [16, 2, 12], [18, 2, null], [20, 2, 15], [26, 3, 20], [32, 3, 25],
    [40, 3.5, 32], [50, 4, 40], [63, 4.5, 50], [75, 5, 65],
  ]),
  ...series("per", [[12, 1.1, null], [16, 1.5, null], [20, 1.9, null], [25, 2.3, null], [32, 2.9, null]]),
  ...outerDiameters("pvc", [16, 20, 25, 32, 40, 50, 63, 75, 80, 90, 100, 110, 125, 140, 160, 200, 250, 315]),
  ...outerDiameters("pehd", [20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 140, 160, 200, 250, 315]),
  ...outerDiameters("pp", [20, 25, 32, 40, 50, 63, 75, 90, 110, 125, 160]),
  // NF EN 877 designates the 78 mm pipe DN 70; French catalogues print it DN 75.
  ...series("fonte-smu", [
    [48, null, 40], [58, null, 50], [78, null, 70], [78, null, 75], [110, null, 100], [135, null, 125],
    [160, null, 150], [210, null, 200], [274, null, 250], [326, null, 300],
  ]),
  ...series("acier", [
    [13.5, 2.3, 8, "1/4\"", "8/13"], [17.2, 2.3, 10, "3/8\"", "12/17"], [21.3, 2.6, 15, "1/2\"", "15/21"],
    [26.9, 2.6, 20, "3/4\"", "20/27"], [33.7, 3.2, 25, "1\"", "26/34"], [42.4, 3.2, 32, "1\"1/4", "33/42"],
    [48.3, 3.2, 40, "1\"1/2", "40/49"], [60.3, 3.6, 50, "2\"", "50/60"], [76.1, 3.6, 65, "2\"1/2", "66/76"],
    [88.9, 4, 80, "3\"", "80/90"], [114.3, 4.5, 100, "4\"", "102/114"], [139.7, 5, 125, "5\""],
    [168.3, null, 150, "6\""], [219.1, null, 200, "8\""], [273, null, 250, "10\""], [323.9, null, 300, "12\""],
  ]),
];

/** Canonical truth key of a DN or outer-diameter label: `DN 22`, `DN 76.1`. */
export function dnKey(value: number) {
  return `DN ${value}`;
}

/** Keys a plan may print for this entry: its label and, when known, its nominal DN. */
export function dnKeysOf(entry: DiameterEntry): string[] {
  const keys = DIAMETER_FAMILIES[entry.family].plan_label === "outer_diameter" ? [dnKey(entry.od_mm)] : [];
  if (entry.nominal_dn !== null) keys.push(dnKey(entry.nominal_dn));
  return [...new Set(keys)];
}

function entriesFor(material: MaterialCode | null | undefined) {
  if (!material) return DIAMETER_TABLE;
  const families = new Set(
    (Object.keys(DIAMETER_FAMILIES) as DiameterFamily[])
      .filter((family) => DIAMETER_FAMILIES[family].materials.includes(material))
  );
  // A material without a series (calorifuge) follows the pipe it wraps: any size.
  return families.size === 0 ? DIAMETER_TABLE : DIAMETER_TABLE.filter((entry) => families.has(entry.family));
}

const knownKeysCache = new Map<MaterialCode | null, ReadonlySet<string>>();

/** DN keys a truth line may use for this material (every series when null). */
export function knownDnKeys(material: MaterialCode | null): ReadonlySet<string> {
  let keys = knownKeysCache.get(material);
  if (!keys) {
    keys = new Set(entriesFor(material).flatMap(dnKeysOf));
    knownKeysCache.set(material, keys);
  }
  return keys;
}

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const OUTER_DIAMETER_TOLERANCE_MM = 0.15;

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[″”“]|''/g, "\"").replace(/\s*\bpouces?\b/g, "\"")
    .replace(/[ø⌀]/g, " o ").replace(/\bdiam(?:etre)?\b\.?/g, " o ").replace(/×/g, "x")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s*([x/])\s*(?=\d)/g, "$1$2")
    .replace(/(\d+)\s+(\d+\/\d+)\s*"/g, "$1\"$2")
    .replace(/"\s+(?=\d+\/)/g, "\"")
    .replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function sameDiameter(left: number, right: number) {
  return Math.abs(left - right) <= OUTER_DIAMETER_TOLERANCE_MM;
}

/**
 * Entries a devis or plan designation refers to, restricted to the material's
 * series. Reads, in this order: an alias (« 20/22 », « 3/4" »), a DN, an
 * outer diameter x wall, « Ø n », « n mm ». The first form found decides;
 * several entries with different outer diameters mean an ambiguous size.
 */
export function findDiameterEntries(text: string, material?: MaterialCode | null): DiameterEntry[] {
  const candidates = entriesFor(material);
  const normalized = normalize(text);

  const byAlias = candidates.filter((entry) => entry.aliases.some((alias) =>
    new RegExp(`(?<![\\w./"])${escapeRegExp(normalize(alias))}(?![\\w./])`).test(normalized)));
  if (byAlias.length > 0) return byAlias;

  const dn = new RegExp(String.raw`\bdn\s*-?\s*${NUMBER}(?![\d.])`).exec(normalized);
  if (dn) {
    const value = Number(dn[1]);
    return candidates.filter((entry) => entry.nominal_dn === value
      || (DIAMETER_FAMILIES[entry.family].plan_label === "outer_diameter" && entry.od_mm === value));
  }

  const outer = new RegExp(String.raw`(?<![\d.])${NUMBER}x${NUMBER}`).exec(normalized)
    ?? new RegExp(String.raw`\bo\s*${NUMBER}(?![\d.])`).exec(normalized)
    ?? new RegExp(String.raw`(?<![\d.x/])${NUMBER}\s*mm\b`).exec(normalized);
  if (!outer) return [];
  const value = Number(outer[1]);
  return candidates.filter((entry) => sameDiameter(entry.od_mm, value));
}
