// Network and material vocabulary of the takeoff (TI-659): generic trade codes and labels found in any French
// plumbing or HVAC estimate, never a client, project or quantity. The aliases are the spellings a devis or a plan
// may print. Adding a code is a reviewed code change.

export type KeyInfo = { label: string; aliases: readonly string[] };

export const NETWORK_CODES = [
  "EF", "EFA", "ECS", "RECS", "EU", "EV", "EUV", "EUG", "EP", "CS", "COND", "VP", "GAZ", "RIA", "SPK",
  "CHW", "CHW-S", "CHW-R", "HW", "HW-S", "HW-R", "GLY", "GLY-S", "GLY-R",
  "HRC", "HRC-S", "HRC-R", "CW", "CW-S", "CW-R",
] as const;
export type NetworkCode = (typeof NETWORK_CODES)[number];

export const NETWORKS: Record<NetworkCode, KeyInfo> = {
  EF: { label: "Eau froide", aliases: ["EF", "eau froide"] },
  EFA: { label: "Eau froide adoucie", aliases: ["EFA", "eau adoucie"] },
  ECS: { label: "Eau chaude sanitaire", aliases: ["ECS", "eau chaude sanitaire"] },
  // « BECS » is left to the ballon organ: plumbing legends print it for « ballon ECS ».
  RECS: { label: "Retour (bouclage) d'eau chaude sanitaire", aliases: ["RECS", "ECS-R", "bouclage ECS"] },
  EU: { label: "Eaux usées", aliases: ["EU", "eaux usees"] },
  EV: { label: "Eaux vannes", aliases: ["EV", "eaux vannes"] },
  EUV: { label: "Eaux usées et eaux vannes confondues", aliases: ["EU/EV", "EU-EV", "EUEV", "EV/EU"] },
  EUG: { label: "Eaux usées grasses", aliases: ["EUG", "eaux grasses"] },
  EP: { label: "Eaux pluviales", aliases: ["EP", "eaux pluviales"] },
  CS: { label: "Colonne sèche", aliases: ["CS", "colonne seche", "colonnes seches"] },
  COND: { label: "Condensats", aliases: ["COND", "condensats"] },
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
  "pehd", "pp", "fonte", "acier", "acier-noir", "acier-galvanise", "calorifuge", "cordon-chauffant",
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
  "cordon-chauffant": {
    label: "Cordon chauffant (longueur tracée le long d'un réseau)",
    aliases: ["cordon chauffant", "ruban chauffant", "tracage electrique"],
  },
};
