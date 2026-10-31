// Known keys of the takeoff bench ground truth (TI-659, used by TI-660 to TI-664).
// Generic trade vocabulary only: codes and labels found in any French plumbing or
// HVAC estimate, never a client, project or quantity. A truth line must use these
// codes; the aliases are the spellings a devis or a plan may print, for the
// deterministic matcher of the bench. Adding a code is a reviewed code change.

export type KeyInfo = { label: string; aliases: readonly string[] };

export const BENCH_LOTS = ["a", "b", "c", "d", "e", "load"] as const;
export type BenchLot = (typeof BENCH_LOTS)[number];

/** Lots that carry a quantity truth; E (page sorting) and the load-test file do not. */
export const TRUTH_LOTS = ["a", "b", "c", "d"] as const;
export type TruthLot = (typeof TRUTH_LOTS)[number];

export const DOCUMENT_KINDS = ["plan", "schema", "devis", "surfaces"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Anonymous document id: `<lot>-<kind>-<nn>`, e.g. `a-plan-01`, `load-plan-01`. */
export const DOCUMENT_ID_PATTERN = /^(a|b|c|d|e|load)-(plan|schema|devis|surfaces)-(\d{2})$/;

export const LINE_KINDS = ["network", "count", "surface"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const UNITS = ["ml", "m2", "u", "ens", "other"] as const;
export type BenchUnit = (typeof UNITS)[number];

/** Units a line kind may use; TI-660 scores ml, u and m2 and lists the others. */
export const UNITS_BY_KIND: Record<LineKind, readonly BenchUnit[]> = {
  network: ["ml", "ens", "other"],
  count: ["u", "ens", "other"],
  surface: ["m2"],
};

/** Why a line cannot be read on the plan (`observable_on_plan: false`). */
export const PLAN_CAUSES = [
  "vertical",
  "weld",
  "tap",
  "install_only",
  "transport",
  "service",
  "not_drawn",
  "off_plan",
  "no_separation",
  "no_scale",
  "other",
] as const;
export type PlanCause = (typeof PLAN_CAUSES)[number];

export const NETWORK_CODES = [
  "EF", "EFA", "ECS", "RECS", "EU", "EV", "EUV", "EUG", "EP", "CS", "VP", "GAZ", "RIA", "SPK",
  "CHW", "CHW-S", "CHW-R", "HW", "HW-S", "HW-R", "GLY", "GLY-S", "GLY-R",
  "HRC", "HRC-S", "HRC-R", "CW", "CW-S", "CW-R",
] as const;
export type NetworkCode = (typeof NETWORK_CODES)[number];

export const NETWORKS: Record<NetworkCode, KeyInfo> = {
  EF: { label: "Eau froide", aliases: ["EF", "eau froide"] },
  EFA: { label: "Eau froide adoucie", aliases: ["EFA", "eau adoucie"] },
  ECS: { label: "Eau chaude sanitaire", aliases: ["ECS", "eau chaude sanitaire"] },
  RECS: { label: "Retour (bouclage) d'eau chaude sanitaire", aliases: ["RECS", "BECS", "ECS-R", "bouclage ECS"] },
  EU: { label: "Eaux usées", aliases: ["EU", "eaux usees"] },
  EV: { label: "Eaux vannes", aliases: ["EV", "eaux vannes"] },
  EUV: { label: "Eaux usées et eaux vannes confondues", aliases: ["EU/EV", "EU-EV", "EUEV", "EV/EU"] },
  EUG: { label: "Eaux usées grasses", aliases: ["EUG", "eaux grasses"] },
  EP: { label: "Eaux pluviales", aliases: ["EP", "eaux pluviales"] },
  CS: { label: "Condensats", aliases: ["CS", "COND", "condensats"] },
  VP: { label: "Ventilation primaire", aliases: ["VP", "ventilation primaire"] },
  GAZ: { label: "Gaz", aliases: ["GAZ", "gaz"] },
  RIA: { label: "Robinets d'incendie armés", aliases: ["RIA", "incendie"] },
  SPK: { label: "Sprinkler", aliases: ["SPK", "sprinkler"] },
  CHW: { label: "Eau glacée, départ et retour confondus", aliases: ["CHW", "EG", "eau glacee"] },
  "CHW-S": { label: "Eau glacée départ", aliases: ["CHW-S", "CHWS", "EG-D", "EG-A", "EGA", "EGD"] },
  "CHW-R": { label: "Eau glacée retour", aliases: ["CHW-R", "CHWR", "EG-R", "EGR"] },
  HW: { label: "Eau chaude de chauffage, départ et retour confondus", aliases: ["HW", "EC", "eau chaude chauffage"] },
  "HW-S": { label: "Eau chaude de chauffage départ", aliases: ["HW-S", "HWS", "EC-D", "EC-A", "ECA", "ECD"] },
  "HW-R": { label: "Eau chaude de chauffage retour", aliases: ["HW-R", "HWR", "EC-R", "ECR"] },
  GLY: { label: "Eau glycolée, départ et retour confondus", aliases: ["GLY", "eau glycolee"] },
  "GLY-S": { label: "Eau glycolée départ", aliases: ["GLY-S", "GLYS", "GLY-D"] },
  "GLY-R": { label: "Eau glycolée retour", aliases: ["GLY-R", "GLYR"] },
  HRC: { label: "Récupération de chaleur, départ et retour confondus", aliases: ["HRC", "recuperation"] },
  "HRC-S": { label: "Récupération de chaleur départ", aliases: ["HRC-S", "HRCS"] },
  "HRC-R": { label: "Récupération de chaleur retour", aliases: ["HRC-R", "HRCR"] },
  CW: { label: "Eau de condensation (tour, dry), départ et retour confondus", aliases: ["CW", "eau de condensation"] },
  "CW-S": { label: "Eau de condensation départ", aliases: ["CW-S", "CWS"] },
  "CW-R": { label: "Eau de condensation retour", aliases: ["CW-R", "CWR"] },
};

export const MATERIAL_CODES = [
  "cuivre", "inox", "inox-304l", "inox-316l", "multicouche", "per", "pvc", "pvc-pression",
  "pehd", "pp", "fonte", "acier", "acier-noir", "acier-galvanise", "calorifuge",
] as const;
export type MaterialCode = (typeof MATERIAL_CODES)[number];

export const MATERIALS: Record<MaterialCode, KeyInfo> = {
  cuivre: { label: "Cuivre", aliases: ["cuivre", "Cu"] },
  inox: { label: "Acier inoxydable, nuance non précisée", aliases: ["inox", "acier inoxydable"] },
  "inox-304l": { label: "Inox 304L (1.4307)", aliases: ["inox 304L", "304L", "1.4307"] },
  "inox-316l": { label: "Inox 316L (1.4404)", aliases: ["inox 316L", "316L", "1.4404"] },
  multicouche: { label: "Multicouche (PE-X/Al/PE-X)", aliases: ["multicouche", "PER-Al", "PEX-AL-PEX"] },
  per: { label: "Polyéthylène réticulé (PER, PE-X)", aliases: ["PER", "PEX", "PE-X"] },
  pvc: { label: "PVC évacuation", aliases: ["PVC", "PVC evacuation"] },
  "pvc-pression": { label: "PVC pression", aliases: ["PVC pression", "PVC PN"] },
  pehd: { label: "Polyéthylène haute densité", aliases: ["PEHD", "PE", "PE100"] },
  pp: { label: "Polypropylène", aliases: ["PP", "PPR", "PP-R"] },
  fonte: { label: "Fonte d'évacuation (SMU)", aliases: ["fonte", "fonte SMU", "SMU"] },
  acier: { label: "Acier, finition non précisée", aliases: ["acier"] },
  "acier-noir": { label: "Acier noir", aliases: ["acier noir", "tube noir"] },
  "acier-galvanise": { label: "Acier galvanisé", aliases: ["acier galvanise", "galva"] },
  calorifuge: { label: "Calorifuge (longueur isolée le long d'un réseau)", aliases: ["calorifuge", "calo", "isolation"] },
};

export const ORGAN_CODES = [
  "vanne", "vanne-equilibrage", "vanne-motorisee", "clapet-anti-retour", "filtre", "purgeur",
  "reducteur-pression", "disconnecteur", "compteur", "manchette-antivibratile", "soupape",
  "robinet-vidange", "robinet-puisage", "clapet-aerateur", "tampon-visite", "siphon-sol",
  "regard", "collecteur", "nourrice", "pompe", "vase-expansion", "echangeur", "ballon",
  "chauffe-eau", "lavabo", "lave-mains", "wc", "urinoir", "evier", "douche", "baignoire",
  "fontaine", "attente", "piquage", "soudure", "support", "fourreau", "radiateur",
  "ventilo-convecteur", "thermometre", "manometre", "doigt-de-gant",
] as const;
export type OrganCode = (typeof ORGAN_CODES)[number];

export const ORGANS: Record<OrganCode, KeyInfo> = {
  vanne: { label: "Vanne ou robinet d'arrêt", aliases: ["vanne", "robinet d'arret", "vanne d'arret"] },
  "vanne-equilibrage": { label: "Vanne d'équilibrage", aliases: ["vanne d'equilibrage"] },
  "vanne-motorisee": { label: "Vanne motorisée 2 ou 3 voies", aliases: ["vanne motorisee", "V2V", "V3V"] },
  "clapet-anti-retour": { label: "Clapet anti-retour", aliases: ["clapet anti-retour"] },
  filtre: { label: "Filtre", aliases: ["filtre", "filtre a tamis"] },
  purgeur: { label: "Purgeur", aliases: ["purgeur", "purgeur d'air"] },
  "reducteur-pression": { label: "Réducteur de pression", aliases: ["reducteur de pression", "detendeur"] },
  disconnecteur: { label: "Disconnecteur", aliases: ["disconnecteur"] },
  compteur: { label: "Compteur", aliases: ["compteur", "sous-compteur"] },
  "manchette-antivibratile": { label: "Manchette antivibratile", aliases: ["manchette antivibratile"] },
  soupape: { label: "Soupape de sûreté", aliases: ["soupape", "groupe de securite"] },
  "robinet-vidange": { label: "Robinet de vidange", aliases: ["vidange", "robinet de vidange"] },
  "robinet-puisage": { label: "Robinet de puisage", aliases: ["robinet de puisage"] },
  "clapet-aerateur": { label: "Clapet aérateur", aliases: ["clapet aerateur"] },
  "tampon-visite": { label: "Tampon de visite ou de dégorgement", aliases: ["tampon de visite", "tampon de degorgement"] },
  "siphon-sol": { label: "Siphon de sol", aliases: ["siphon de sol"] },
  regard: { label: "Regard", aliases: ["regard"] },
  collecteur: { label: "Collecteur", aliases: ["collecteur"] },
  nourrice: { label: "Nourrice", aliases: ["nourrice"] },
  pompe: { label: "Pompe ou circulateur", aliases: ["pompe", "circulateur"] },
  "vase-expansion": { label: "Vase d'expansion", aliases: ["vase d'expansion"] },
  echangeur: { label: "Échangeur", aliases: ["echangeur"] },
  ballon: { label: "Ballon de stockage", aliases: ["ballon", "ballon tampon"] },
  "chauffe-eau": { label: "Chauffe-eau", aliases: ["chauffe-eau"] },
  lavabo: { label: "Lavabo ou vasque", aliases: ["lavabo", "vasque"] },
  "lave-mains": { label: "Lave-mains", aliases: ["lave-mains"] },
  wc: { label: "WC", aliases: ["WC", "cuvette"] },
  urinoir: { label: "Urinoir", aliases: ["urinoir"] },
  evier: { label: "Évier", aliases: ["evier"] },
  douche: { label: "Douche", aliases: ["douche"] },
  baignoire: { label: "Baignoire", aliases: ["baignoire"] },
  fontaine: { label: "Fontaine réfrigérée", aliases: ["fontaine"] },
  attente: { label: "Attente (réseau laissé en attente)", aliases: ["attente", "en attente"] },
  piquage: { label: "Piquage", aliases: ["piquage"] },
  soudure: { label: "Soudure", aliases: ["soudure"] },
  support: { label: "Support ou collier", aliases: ["support", "collier"] },
  fourreau: { label: "Fourreau ou traversée", aliases: ["fourreau", "traversee"] },
  radiateur: { label: "Radiateur", aliases: ["radiateur"] },
  "ventilo-convecteur": { label: "Ventilo-convecteur", aliases: ["ventilo-convecteur"] },
  thermometre: { label: "Thermomètre", aliases: ["thermometre"] },
  manometre: { label: "Manomètre", aliases: ["manometre"] },
  "doigt-de-gant": { label: "Doigt de gant", aliases: ["doigt de gant"] },
};
