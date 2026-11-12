import type { MaterialCode, NetworkCode } from "@/lib/takeoff/bench/keys";

// Classes and generic keywords of the vector reading (TI-662 step 3). Only
// trade codes found in any French plumbing or HVAC drawing are written here,
// never a company prefix nor a real layer name: a document-specific mapping
// belongs to the private dataset (truth/groups/<id>.json), never to Git.
// - A layer name is cut on « _ », spaces, « - » and « / »; each segment is
//   compared, accents and case removed, with the tokens below. A code inside a
//   longer segment never matches (EV is not in « EVIER »).
// - A network with supply and return (CHW, HW, GLY, HRC, CW) takes « -S » or
//   « -R » from a direction segment (S, A, D, ALLER, DEPART, SUPPLY; R, RETOUR,
//   RETURN). EU with EV is EUV. Two other networks: no class (« à revoir »).
// - A text or dimension layer is « texte » or « cotation » even when it names a
//   network (its strokes are leaders and frames, never pipes); then networks;
//   then walls and partitions; then the background (« fond »).

export const OTHER_CLASSES = ["mur", "cloison", "fond", "cotation", "texte", "autre"] as const;
export type OtherClass = (typeof OTHER_CLASSES)[number];
export type VectorClass = NetworkCode | OtherClass;

const NETWORK_TOKENS: Record<string, NetworkCode> = {
  EF: "EF", EFS: "EF", EFSG: "EF", EFAR: "EF", EFF: "EF", AEP: "EF", EFA: "EFA",
  ECS: "ECS", RECS: "RECS", EU: "EU", EV: "EV", EUV: "EUV", EUEV: "EUV", EUG: "EUG",
  EP: "EP", EPR: "EP", EPL: "EP", CS: "CS", COND: "COND", VP: "VP", GAZ: "GAZ", RIA: "RIA", SPK: "SPK",
  CHW: "CHW", EG: "CHW", EGVC: "CHW", CHWS: "CHW-S", CHWR: "CHW-R", EGA: "CHW-S", EGD: "CHW-S", EGR: "CHW-R",
  HW: "HW", EC: "HW", ECVC: "HW", HWS: "HW-S", HWR: "HW-R", ECA: "HW-S", ECD: "HW-S", ECR: "HW-R",
  GLY: "GLY", GLYS: "GLY-S", GLYR: "GLY-R", HRC: "HRC", HRCS: "HRC-S", HRCR: "HRC-R", CW: "CW", CWS: "CW-S", CWR: "CW-R",
};

const DIRECTED: Partial<Record<NetworkCode, { supply: NetworkCode; return: NetworkCode }>> = {
  CHW: { supply: "CHW-S", return: "CHW-R" }, HW: { supply: "HW-S", return: "HW-R" }, GLY: { supply: "GLY-S", return: "GLY-R" },
  HRC: { supply: "HRC-S", return: "HRC-R" }, CW: { supply: "CW-S", return: "CW-R" },
};
const SUPPLY = new Set(["S", "A", "D", "ALLER", "DEPART", "SUPPLY"]);
const RETURN = new Set(["R", "RETOUR", "RETURN"]);

const OTHER_TOKENS: Record<string, OtherClass> = {
  TEXTE: "texte", TEXTES: "texte", TEXT: "texte", TEXTS: "texte", TEXTOS: "texte",
  COTE: "cotation", COTES: "cotation", COTATION: "cotation", COTATIONS: "cotation", DIM: "cotation", DIMENSION: "cotation", DIMENSIONS: "cotation",
  MUR: "mur", MURS: "mur", WALL: "mur", WALLS: "mur", CLOISON: "cloison", CLOISONS: "cloison", PARTITION: "cloison", PARTITIONS: "cloison",
  XREF: "fond", FOND: "fond",
};
const OTHER_PRIORITY: OtherClass[] = ["texte", "cotation", "mur", "cloison", "fond"];

export function normalizeToken(segment: string) {
  return segment.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/** Segments of a layer name (TI-662: « _ », spaces, « - », « / »). */
export function layerSegments(name: string) {
  // A level (R+1, R-1, RDC, SS2) is no segment: its « R » would read as a return.
  return name.replace(/(?:^|(?<=[_\s/]))(?:R[+-]\d{1,2}|RDC|SS\d{1,2})(?=$|[_\s/-])/gi, " ")
    .split(/[_\s\-/]+/).map(normalizeToken).filter((segment) => segment.length > 0);
}

/** The network named by a list of segments, with its direction, or null (none or two networks). */
export function networkOfSegments(segments: readonly string[]): NetworkCode | null {
  const found = new Set<NetworkCode>();
  for (const segment of segments) {
    const code = NETWORK_TOKENS[segment];
    if (code) found.add(code);
  }
  if (found.has("EU") && found.has("EV")) {
    found.delete("EU");
    found.delete("EV");
    found.add("EUV");
  }
  if (found.size !== 1) return null;
  const [network] = found;
  const directed = DIRECTED[network];
  if (!directed) return network;
  const supply = segments.some((segment) => SUPPLY.has(segment));
  const back = segments.some((segment) => RETURN.has(segment));
  return supply === back ? network : supply ? directed.supply : directed.return;
}

/** The class a layer name gives by keyword, or null (« à revoir »). */
export function classOfLayerName(name: string): VectorClass | null {
  const segments = layerSegments(name);
  const others = new Set(segments.map((segment) => OTHER_TOKENS[segment]).filter((value): value is OtherClass => value !== undefined));
  if (others.has("texte")) return "texte";
  if (others.has("cotation")) return "cotation";
  const network = networkOfSegments(segments);
  if (network) return network;
  return OTHER_PRIORITY.find((candidate) => others.has(candidate)) ?? null;
}

// Joinery and openings (doors, windows): no class of their own (the persisted
// classes are a closed list), but their strokes close the rooms that walls
// leave open at a doorway or a window (surfaces.ts, fill.ts).
const OPENING_TOKENS = new Set(["MENUISERIE", "MENUISERIES", "PORTE", "PORTES", "DOOR", "DOORS", "FENETRE", "FENETRES", "WINDOW", "WINDOWS"]);

/** Whether a layer name names joinery or openings (« FICTIF_MENUISERIES », « Portes »): a barrier of the room fill, never a class. */
export function isOpeningLayerName(name: string) {
  return layerSegments(name).some((segment) => OPENING_TOKENS.has(segment));
}

// Layers that never hold a pipe (TI-704, Decisions candidates only: they keep no class, « à revoir »): a frame or
// title block, and the architecture's furniture, tiling and joinery (isOpeningLayerName).
const FRAME_LAYER_TOKENS = new Set(["CARTOUCHE", "CARTOUCHES", "CADRE", "CADRES", "FRAME", "FRAMES", "TITLEBLOCK", "BORDER", "BORDERS"]);
const ARCHITECTURE_LAYER_TOKENS = new Set(["MOBILIER", "FURNITURE", "CALEPINAGE", "ARCHI", "ARCHITECTURE"]);

/** Whether a layer name names a frame or title block (« FICTIF_CARTOUCHE ») or the architecture's furniture or joinery. */
export function nonNetworkLayerKind(name: string): "frame" | "architecture" | null {
  const segments = layerSegments(name);
  if (segments.some((segment) => FRAME_LAYER_TOKENS.has(segment))) return "frame";
  if (segments.some((segment) => ARCHITECTURE_LAYER_TOKENS.has(segment)) || isOpeningLayerName(name)) return "architecture";
  return null;
}

// Air-duct codes of a French ventilation legend (TI-704): fresh, supply, return, rejected and extract air, smoke
// extraction and its make-up air, mechanical ventilation. None is a network code (NETWORK_TOKENS), and none a
// plumbing code: « EA » (softened water), « AE » or « AT » are left out, as the English forms are.
const AIR_DUCT_TOKENS = new Set(["AN", "AS", "AR", "ARJ", "AREJ", "AEX", "AX", "VMC", "EXD", "AND"]);

/**
 * The air-duct code a legend entry names (« AN », « AEX »), or null: the code alone, written in capitals, so that a
 * word of a sentence (« an », « as ») never reads as one.
 */
export function airDuctOfLegendCode(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed !== trimmed.toUpperCase()) return null;
  const compact = normalizeToken(trimmed).replace(/\s+/g, "");
  return AIR_DUCT_TOKENS.has(compact) && NETWORK_TOKENS[compact] === undefined ? compact : null;
}

/**
 * The network a legend entry names: its code alone (« EU/EV », « EG VC »), spaces removed, with its direction
 * (« CHW-S », « EG-R »). Every part is a code or a direction: « EU - PVC » is a pipe label, not a legend code.
 */
export function networkOfLegendCode(text: string): NetworkCode | null {
  const compact = normalizeToken(text).replace(/\s+/g, "");
  if (!/^[A-Z]{2,5}(?:[/-][A-Z]{1,6})?$/.test(compact)) return null;
  const segments = compact.split(/[/-]/);
  if (!segments.every((segment) => NETWORK_TOKENS[segment] !== undefined || SUPPLY.has(segment) || RETURN.has(segment))) return null;
  return networkOfSegments(segments);
}

const MATERIAL_PATTERNS: Array<{ code: MaterialCode; label: string; pattern: RegExp }> = [
  { code: "inox-316l", label: "Inox 316L", pattern: /\b(?:inox\s*)?316\s*L\b/i },
  { code: "inox-304l", label: "Inox 304L", pattern: /\b(?:inox\s*)?304\s*L\b/i },
  { code: "inox", label: "Inox", pattern: /\binox\b/i },
  { code: "pvc-pression", label: "PVC pression", pattern: /\bPVC\s*(?:pression|PN)\b/i },
  { code: "pvc", label: "PVC", pattern: /\bPVC\b/i },
  { code: "multicouche", label: "multicouche", pattern: /\bmulticouche\b|\bPER-?Al\b/i },
  { code: "per", label: "PER", pattern: /\bPE-?X\b|\bPER\b/ },
  { code: "pehd", label: "PEHD", pattern: /\bPEHD\b|\bPE100\b/ },
  { code: "cuivre", label: "cuivre", pattern: /\bcuivre\b|\bCu\b/ },
  { code: "fonte", label: "fonte SMU", pattern: /\bfonte\b|\bSMU\b/i },
  { code: "acier-galvanise", label: "acier galvanisé", pattern: /\bgalva(?:nis[ée])?\b/i },
  { code: "acier-noir", label: "acier noir", pattern: /\bacier\s+noir\b|\btube\s+noir\b/i },
  { code: "acier", label: "acier", pattern: /\bacier\b/i },
];

/** How a plan prints a size: a nominal DN (« DN 100 ») or an outer diameter (« Ø 110 »). */
export type SizeNotation = "DN" | "Ø";

/**
 * A size as its plan label prints it (TI-683, D7): « DN 100 » and « Ø 110 » are never rewritten into one another, the
 * series of the material and of its usage tells what tube each names. A size whose notation was not kept (a reading
 * of before TI-683) prints « DN n », as it always was.
 */
export function printedSize(dn: number, notation: SizeNotation | null | undefined) {
  return `${notation ?? "DN"} ${dn}`;
}

export type PipeLabel = {
  network: NetworkCode | null;
  material: MaterialCode | null;
  materialLabel: string | null;
  dn: number | null;
  /** The notation of the size the label prints, null without a size. */
  notation: SizeNotation | null;
  /** The label says the run is insulated (« + calo », « +c20 », « calorifugé »): its insulation length is its length. */
  insulated: boolean;
};

/**
 * Network, material and size of a pipe label (« EU - PVC Me DN 40 », « EG-A Plf - Inox 316L DN 22 +c20 »,
 * « EU - Fonte Ø 110 »): the size with the notation it is printed in.
 * The network is read in the head of the label (before its first « - » followed by a space, or its first
 * two words), so that a material or a note never reads as a network.
 */
export function parsePipeLabel(text: string): PipeLabel {
  const clean = text.replace(/\s+/g, " ").trim();
  const head = clean.split(/\s-\s|\s–\s/)[0] ?? clean;
  const headSegments = head.split(/[\s\-/.]+/).slice(0, 3).map(normalizeToken).filter(Boolean);
  let network = networkOfSegments(headSegments.slice(0, 2));
  if (!network && headSegments.length > 0) network = networkOfSegments(headSegments.slice(0, 1));
  const material = MATERIAL_PATTERNS.find((entry) => entry.pattern.test(clean)) ?? null;
  const nominal = /\bDN\s*(\d{1,4}(?:[.,]\d)?)\b/i.exec(clean);
  const dnMatch = nominal ?? /[Øø⌀∅]\s*(\d{2,4}(?:[.,]\d)?)\b/.exec(clean);
  const value = dnMatch ? Number(dnMatch[1].replace(",", ".")) : null;
  const dn = value !== null && Number.isFinite(value) ? value : null;
  const insulated = /\+\s*c\s*\d{2}\b|\+\s*calo\b|\bcalorifug/i.test(clean);
  return { network, material: material?.code ?? null, materialLabel: material?.label ?? null, dn,
    notation: dn === null ? null : nominal ? "DN" : "Ø", insulated };
}
