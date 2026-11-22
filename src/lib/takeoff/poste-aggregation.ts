import type { PosteAnswerOutcome } from "@/lib/takeoff/poste-exchange";
import type { PosteReasonCode } from "@/lib/takeoff/poste-exchange-merge";

/**
 * The state of an item on the affaire from its answers on the plans it is expected on (lot 4, section 3.2): the rule the
 * table of items calls (lot 4 PR 4). While a plan is unread the observed total stays partial and an absence is never
 * certified; once every expected plan is answered, one uncertain answer makes the item uncertain, otherwise a measure
 * makes it measured, and only plans all searched without any indication make it not found.
 */
export const POSTE_AFFAIRE_STATUSES = ["to_measure", "reading", "incomplete", "failed", "measured", "uncertain", "not_found"] as const;
export type PosteAffaireStatus = (typeof POSTE_AFFAIRE_STATUSES)[number];

/**
 * An expected plan of the item, as the table knows it: its live answer, or the work still without one. to_measure: no
 * reading started; reading: its analysis runs; incomplete: its reading ended without an exact answer for the item (a
 * refused exchange, a stopped request, a spent budget); failed: its analysis failed otherwise.
 */
export type PostePlanWork =
  | { planKey: string; state: "to_measure" | "reading" | "incomplete" | "failed" }
  | {
    planKey: string;
    state: "answered";
    outcome: PosteAnswerOutcome;
    quantity: { value: number; unit: string } | null;
    candidate: { value: number; unit: string } | null;
  };

export type PosteAffaireAggregate = {
  status: PosteAffaireStatus;
  /** Every expected plan answered: the status is a verdict, not the work in progress. */
  complete: boolean;
  /** The observed total does not cover every expected plan yet. */
  partial: boolean;
  plans: { expected: number; answered: number; measured: number; uncertain: number; notFound: number };
  /** The measured plans' quantities, added per unit (sorted by unit). */
  observed: Array<{ unit: string; value: number }>;
  /** The uncertain plans' candidate values, per unit: never part of the measure. */
  candidates: Array<{ unit: string; value: number }>;
};

const PROGRESS_ORDER = ["failed", "incomplete", "reading", "to_measure"] as const;

function totals(values: ReadonlyArray<{ value: number; unit: string } | null>) {
  const byUnit = new Map<string, number>();
  for (const entry of values) if (entry) byUnit.set(entry.unit, (byUnit.get(entry.unit) ?? 0) + entry.value);
  return [...byUnit].sort(([left], [right]) => left.localeCompare(right))
    .map(([unit, value]) => ({ unit, value: Number(value.toFixed(6)) }));
}

/** The item's state over its expected plans (one entry per plan: a second answer for one plan is refused, never added). */
export function aggregatePosteAnswers(plans: readonly PostePlanWork[]): PosteAffaireAggregate {
  const seen = new Set<string>();
  for (const plan of plans) {
    if (seen.has(plan.planKey)) throw new Error(`Two answers for one plan of an item: ${plan.planKey}.`);
    seen.add(plan.planKey);
  }
  const answered = plans.filter((plan): plan is Extract<PostePlanWork, { state: "answered" }> => plan.state === "answered");
  const count = (outcome: PosteAnswerOutcome) => answered.filter((plan) => plan.outcome === outcome).length;
  const observed = totals(answered.filter((plan) => plan.outcome === "measured").map((plan) => plan.quantity));
  const candidates = totals(answered.filter((plan) => plan.outcome === "uncertain").map((plan) => plan.candidate));
  const complete = plans.length > 0 && answered.length === plans.length;
  let status: PosteAffaireStatus;
  if (!complete) {
    status = PROGRESS_ORDER.find((state) => plans.some((plan) => plan.state === state)) ?? "to_measure";
  } else if (count("uncertain") > 0 || observed.length > 1) {
    status = "uncertain";
  } else {
    status = count("measured") > 0 ? "measured" : "not_found";
  }
  return {
    status, complete, partial: !complete,
    plans: { expected: plans.length, answered: answered.length, measured: count("measured"), uncertain: count("uncertain"),
      notFound: count("not_found") },
    observed, candidates,
  };
}

const STATUS_LABELS: Record<PosteAffaireStatus, string> = {
  to_measure: "À mesurer",
  reading: "En lecture",
  incomplete: "Lecture incomplète",
  failed: "Échec de lecture",
  measured: "Mesuré",
  uncertain: "À vérifier",
  not_found: "Non trouvé",
};

/** The status of an item, as the table shows it. */
export function describePosteStatus(status: PosteAffaireStatus) {
  return STATUS_LABELS[status];
}

const REASON_TEXTS: Record<PosteReasonCode, string> = {
  AMBIGUOUS_INDICATION: "Indice ambigu sur le plan.",
  PARTIAL_QUANTITY: "Quantité partielle : une partie seulement est lisible.",
  CONTRADICTORY_EVIDENCE: "Indices contradictoires sur le plan.",
  SCALE_UNKNOWN: "Échelle ou cote manquante : la longueur ou la surface n’est pas mesurable.",
  UNIT_OR_BASIS_UNCLEAR: "Unité ou base de mesure à préciser.",
  QUALIFIER_UNREADABLE: "Réseau, matière ou diamètre illisible.",
  ESTIMATE: "Estimation : la valeur n’est pas une mesure du plan.",
  OTHER: "Autre motif : voir la remarque de la lecture.",
  NO_INDICATION: "Aucun indice sur les pages lues.",
  UNIT_MISMATCH: "Unité lue différente de celle du poste, ou plusieurs unités.",
  NON_INTEGER_COUNT: "Comptage non entier pour un poste compté à l’unité.",
  READINGS_DISAGREE: "Deux lectures du même endroit ne concordent pas.",
  PAGES_UNREADABLE: "Pages illisibles : la lecture ne couvre pas tout le plan.",
  VECTOR_ONLY: "Trouvé par la lecture vectorielle seule : à vérifier.",
  DUPLICATE_READING: "Deux lectures de la même page que rien ne distingue : comptées une fois, à vérifier.",
  SAME_OBJECT_UNCLEAR: "Une lecture renvoie à un objet que la page ne relève pas, ou à plusieurs.",
  BASIS_MISMATCH: "Mesure sur une autre base que celle du poste, ou sur deux bases.",
  BASIS_UNSTATED: "Base de la mesure non précisée.",
  QUANTITY_ESTIMATED: "Quantité estimée : le métré est une estimation, la valeur n’est comptée qu’une fois confirmée.",
  NOT_OBSERVABLE: "Quantité non lisible sur un plan (support, soudure…) : à saisir avec sa justification.",
  QUANTITY_OUT_OF_RANGE: "Quantité lue hors de toute mesure possible : à vérifier sur le plan.",
  VECTOR_READINGS_UNATTACHED: "Trop de lectures vectorielles pour ce poste : elles restent dans le résultat, à vérifier.",
};

/** The reason of an answer, as the table and its detail show it. */
export function describePosteReason(code: PosteReasonCode) {
  return REASON_TEXTS[code];
}
