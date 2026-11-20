import type { KeyInfo } from "@/lib/takeoff/trade-keys";

// Known keys of the takeoff bench ground truth (TI-659, used by TI-660 to TI-664).
// Generic trade vocabulary only: codes and labels found in any French plumbing or
// HVAC estimate, never a client, project or quantity. A truth line must use these
// codes; the aliases are the spellings a devis or a plan may print, for the
// deterministic matcher of the bench. Adding a code is a reviewed code change.

export const BENCH_LOTS = ["a", "b", "c", "d", "e", "load"] as const;

/** Lots that carry a quantity truth; E (page sorting) and the load-test file do not. */
export const TRUTH_LOTS = ["a", "b", "c", "d"] as const;
export type TruthLot = (typeof TRUTH_LOTS)[number];

export const DOCUMENT_KINDS = ["plan", "schema", "devis", "surfaces"] as const;

/** Anonymous document id: `<lot>-<kind>-<nn>`, e.g. `a-plan-01`, `load-plan-01`. */
export const DOCUMENT_ID_PATTERN = /^(a|b|c|d|e|load)-(plan|schema|devis|surfaces)-(\d{2})$/;

export const LINE_KINDS = ["network", "count", "surface"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const UNITS = ["ml", "m2", "u", "ens", "other"] as const;
export type BenchUnit = (typeof UNITS)[number];

/**
 * Units a line kind may use; TI-660 scores ml, u and m2 and lists the others.
 * A network line in m2 is an insulation surface (material calorifuge), kept in
 * the unit of the devis cell that prices it; a pipe length is never in m2.
 */
export const UNITS_BY_KIND: Record<LineKind, readonly BenchUnit[]> = {
  network: ["ml", "m2", "ens", "other"],
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

/**
 * The plan causes a reviewer may give a key the bench missed on an observable
 * line (TI-660 §5): vertical, non dessiné, hors plan, pas de séparation,
 * prestation. A line not observable on the plan takes any of PLAN_CAUSES.
 */
export const REVIEWED_PLAN_CAUSES = ["vertical", "not_drawn", "off_plan", "no_separation", "service"] as const satisfies readonly PlanCause[];

export const ORGAN_CODES = [
  "vanne", "vanne-equilibrage", "vanne-motorisee", "clapet-anti-retour", "clapet-anti-pollution",
  "anti-siphonnage", "filtre", "purgeur", "reducteur-pression", "disconnecteur", "compteur",
  "manchette-antivibratile", "manchette-temoin", "mitigeur", "soupape",
  "robinet-vidange", "robinet-puisage", "clapet-aerateur", "tampon-visite", "siphon-sol",
  "regard", "collecteur", "nourrice", "skid", "pompe", "vase-expansion", "echangeur", "ballon",
  "chauffe-eau", "lavabo", "lave-mains", "wc", "urinoir", "evier", "vidoir", "douche", "baignoire",
  "fontaine", "attente", "piquage", "soudure", "support", "fourreau", "raccordement-electrique",
  "radiateur", "ventilo-convecteur", "thermometre", "manometre", "doigt-de-gant",
] as const;
export type OrganCode = (typeof ORGAN_CODES)[number];

export const ORGANS: Record<OrganCode, KeyInfo> = {
  vanne: { label: "Vanne ou robinet d'arrêt", aliases: ["vanne", "robinet d'arret", "vanne d'arret"] },
  "vanne-equilibrage": { label: "Vanne d'équilibrage", aliases: ["vanne d'equilibrage"] },
  "vanne-motorisee": { label: "Vanne motorisée 2 ou 3 voies", aliases: ["vanne motorisee", "V2V", "V3V"] },
  "clapet-anti-retour": { label: "Clapet anti-retour", aliases: ["clapet anti-retour"] },
  "clapet-anti-pollution": {
    label: "Clapet anti-pollution (anti-retour contrôlable, type EA)",
    aliases: ["clapet anti-pollution", "clapet anti pollution", "clapet EA"],
  },
  "anti-siphonnage": { label: "Dispositif anti-siphonnage (casse-vide)", aliases: ["anti-siphonnage", "casse-vide"] },
  filtre: { label: "Filtre", aliases: ["filtre", "filtre a tamis"] },
  purgeur: { label: "Purgeur", aliases: ["purgeur", "purgeur d'air"] },
  "reducteur-pression": { label: "Réducteur de pression", aliases: ["reducteur de pression", "detendeur"] },
  disconnecteur: { label: "Disconnecteur", aliases: ["disconnecteur"] },
  compteur: { label: "Compteur", aliases: ["compteur", "sous-compteur"] },
  "manchette-antivibratile": { label: "Manchette antivibratile", aliases: ["manchette antivibratile"] },
  "manchette-temoin": { label: "Manchette témoin (contrôle de corrosion)", aliases: ["manchette temoin"] },
  mitigeur: { label: "Mitigeur, thermostatique ou non", aliases: ["mitigeur", "mitigeur thermostatique", "MT"] },
  soupape: { label: "Soupape de sûreté", aliases: ["soupape", "groupe de securite"] },
  "robinet-vidange": { label: "Robinet de vidange", aliases: ["vidange", "robinet de vidange"] },
  "robinet-puisage": { label: "Robinet de puisage", aliases: ["robinet de puisage"] },
  "clapet-aerateur": { label: "Clapet aérateur", aliases: ["clapet aerateur"] },
  "tampon-visite": { label: "Tampon de visite ou de dégorgement", aliases: ["tampon de visite", "tampon de degorgement"] },
  "siphon-sol": { label: "Siphon de sol", aliases: ["siphon de sol"] },
  regard: { label: "Regard", aliases: ["regard"] },
  collecteur: { label: "Collecteur", aliases: ["collecteur"] },
  nourrice: { label: "Nourrice", aliases: ["nourrice"] },
  skid: {
    label: "Skid hydraulique (module préfabriqué de vannes et de raccordement d'un terminal)",
    aliases: ["skid", "skid hydraulique"],
  },
  pompe: { label: "Pompe ou circulateur", aliases: ["pompe", "circulateur"] },
  "vase-expansion": { label: "Vase d'expansion", aliases: ["vase d'expansion"] },
  echangeur: { label: "Échangeur", aliases: ["echangeur"] },
  ballon: { label: "Ballon de stockage", aliases: ["ballon", "ballon tampon", "ballon ECS", "BECS"] },
  "chauffe-eau": { label: "Chauffe-eau", aliases: ["chauffe-eau"] },
  lavabo: { label: "Lavabo ou vasque", aliases: ["lavabo", "vasque"] },
  "lave-mains": { label: "Lave-mains", aliases: ["lave-mains"] },
  wc: { label: "WC", aliases: ["WC", "cuvette"] },
  urinoir: { label: "Urinoir", aliases: ["urinoir"] },
  evier: { label: "Évier", aliases: ["evier"] },
  vidoir: { label: "Vidoir", aliases: ["vidoir"] },
  douche: { label: "Douche", aliases: ["douche"] },
  baignoire: { label: "Baignoire", aliases: ["baignoire"] },
  fontaine: { label: "Fontaine réfrigérée", aliases: ["fontaine"] },
  attente: { label: "Attente (réseau laissé en attente)", aliases: ["attente", "en attente"] },
  piquage: { label: "Piquage", aliases: ["piquage"] },
  soudure: { label: "Soudure", aliases: ["soudure"] },
  support: { label: "Support ou collier", aliases: ["support", "collier"] },
  fourreau: { label: "Fourreau ou traversée", aliases: ["fourreau", "traversee"] },
  "raccordement-electrique": {
    label: "Raccordement électrique d'un appareil (prestation)",
    aliases: ["raccordement electrique"],
  },
  radiateur: { label: "Radiateur", aliases: ["radiateur"] },
  "ventilo-convecteur": { label: "Ventilo-convecteur", aliases: ["ventilo-convecteur"] },
  thermometre: { label: "Thermomètre", aliases: ["thermometre"] },
  manometre: { label: "Manomètre", aliases: ["manometre"] },
  "doigt-de-gant": { label: "Doigt de gant", aliases: ["doigt de gant"] },
};
