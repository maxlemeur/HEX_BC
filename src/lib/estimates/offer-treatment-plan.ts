import { z } from "zod";

import {
  OFFER_EXCLUSION_REASON_CODES,
  OFFER_LIMITS_TEXT_MAX_LENGTH,
  OFFER_RESERVE_BASES,
  OFFER_RESERVE_BASIS_LABELS,
  OFFER_RESERVE_TEXT_MAX_LENGTH,
  OFFER_TREATMENT_NOTE_MAX_LENGTH,
  buildOfferReserveSentence,
  effectiveOfferTreatment,
  normalizeOfferTreatmentText,
  offerTreatmentKindForStatus,
  offerTreatmentSchema,
  readOfferTreatment,
  rewriteOfferLimitsText,
  type OfferReserveBasis,
} from "@/lib/estimates/offer-treatment";

/**
 * TI-682: what one save of « Motifs et réserves » writes. Pure: the server reads the lines and the offer text, this
 * module decides, and public.set_estimate_line_offer_treatments writes the decisions and the text in one transaction.
 */
export const OFFER_TREATMENT_MAX_DECISIONS = 500;

const oneLine = (max: number, message: string) => z.string()
  .transform(normalizeOfferTreatmentText)
  .pipe(z.string().min(1, message).max(max, message));

const exclusionDecisionSchema = z.object({
  kind: z.literal("internal_exclusion"),
  reason_code: z.enum(OFFER_EXCLUSION_REASON_CODES),
  note: z.union([z.string(), z.null()]).optional()
    .transform((value) => {
      const text = normalizeOfferTreatmentText(value ?? "");
      return text.length > 0 ? text : null;
    })
    .pipe(z.string().max(OFFER_TREATMENT_NOTE_MAX_LENGTH, "La précision du motif dépasse 500 caractères.").nullable()),
}).strict().refine((value) => value.reason_code !== "other" || value.note !== null,
  { message: "Précisez le motif « Autre motif ».", path: ["note"] });

const reserveDecisionSchema = z.object({
  kind: z.literal("offer_reserve"),
  basis: z.enum(OFFER_RESERVE_BASES),
  text: oneLine(OFFER_RESERVE_TEXT_MAX_LENGTH, "Le texte de la réserve compte 1 à 500 caractères."),
}).strict();

export const setOfferTreatmentsSchema = z.object({
  expected_content_revision: z.number().int().min(0),
  decisions: z.array(z.object({
    item_id: z.string().uuid("Ligne invalide."),
    /** Null withdraws the decision of the line. */
    decision: z.union([exclusionDecisionSchema, reserveDecisionSchema, z.null()]),
  }).strict()).min(1, "Aucune décision à enregistrer.").max(OFFER_TREATMENT_MAX_DECISIONS,
    "Trop de lignes dans une seule demande (500 au plus)."),
}).strict().refine((value) => new Set(value.decisions.map((entry) => entry.item_id)).size === value.decisions.length,
  { message: "Une ligne ne reçoit qu’une décision par demande.", path: ["decisions"] });

export type SetOfferTreatmentsInput = z.infer<typeof setOfferTreatmentsSchema>;

/** What the route answers: the version as saved, and the decision each named line now carries. */
export const setOfferTreatmentsResultSchema = z.object({
  version: z.object({
    id: z.string().uuid(),
    content_revision: z.number().int(),
    updated_at: z.string(),
    exclusions: z.string().nullable(),
  }),
  items: z.array(z.object({ id: z.string().uuid(), offer_treatment: offerTreatmentSchema.nullable() })),
});

export type SetOfferTreatmentsResult = z.infer<typeof setOfferTreatmentsResultSchema>;

export type OfferTreatmentPlanLine = {
  id: string;
  item_type: string;
  title: string | null;
  pricing_status: unknown;
  source_metadata: unknown;
};

export type OfferTreatmentPlanRefusal =
  | { code: "OFFER_TREATMENT_LINE_NOT_FOUND"; item_ids: string[] }
  | { code: "OFFER_TREATMENT_STATUS_MISMATCH"; item_ids: string[] }
  | { code: "OFFER_RESERVE_BASIS_CONFLICT"; bases: OfferReserveBasis[] }
  | { code: "OFFER_LIMITS_TEXT_TOO_LONG"; length: number };

export const OFFER_TREATMENT_REFUSAL_MESSAGES: Readonly<Record<OfferTreatmentPlanRefusal["code"], string>> = {
  OFFER_TREATMENT_LINE_NOT_FOUND: "Une ligne de cette demande n’appartient plus à ce devis. Rechargez-le.",
  OFFER_TREATMENT_STATUS_MISMATCH:
    "Un motif d’exclusion vaut pour une ligne Inclus, Pour mémoire, Hors lot ou Sans objet ; une réserve pour une ligne Chiffrée ou Non chiffrée. Le statut d’une ligne a changé : rechargez le devis.",
  OFFER_RESERVE_BASIS_CONFLICT:
    "Les réserves d’un devis reposent sur une seule base : devis privé, ou quantités déclarées indicatives par le règlement de consultation.",
  OFFER_LIMITS_TEXT_TOO_LONG:
    "Avec ces réserves, « Précisions et limites de prestation » dépasserait 5 000 caractères. Raccourcissez ce texte ou les réserves.",
};

export type OfferTreatmentPlan =
  | { ok: false; refusal: OfferTreatmentPlanRefusal }
  | {
    ok: true;
    /** The p_treatments argument of the writer: the choice only, the database adds its author and instant. */
    treatments: { item_id: string; treatment: Record<string, string | null> | null }[];
    /** The offer text to save with the decisions. */
    exclusions: string | null;
  };

/**
 * `lines` holds every line the request names and every other line of the version that already carries a decision,
 * so that the basis of all its reserves is checked. A reserve is refused in a public tender by not having a basis
 * to state: the two bases are the only ones.
 */
export function planOfferTreatments(input: {
  decisions: SetOfferTreatmentsInput["decisions"];
  lines: readonly OfferTreatmentPlanLine[];
  exclusions: string | null;
}): OfferTreatmentPlan {
  const byId = new Map(input.lines.map((line) => [line.id, line]));
  const missing = input.decisions.filter((entry) => byId.get(entry.item_id)?.item_type !== "line");
  if (missing.length > 0) {
    return { ok: false, refusal: { code: "OFFER_TREATMENT_LINE_NOT_FOUND", item_ids: missing.map((entry) => entry.item_id) } };
  }
  const mismatched = input.decisions.filter((entry) => entry.decision !== null
    && offerTreatmentKindForStatus(byId.get(entry.item_id)!.pricing_status) !== entry.decision.kind);
  if (mismatched.length > 0) {
    return { ok: false, refusal: { code: "OFFER_TREATMENT_STATUS_MISMATCH", item_ids: mismatched.map((entry) => entry.item_id) } };
  }

  const treatments: { item_id: string; treatment: Record<string, string | null> | null }[] = [];
  const remove: string[] = [];
  const add: string[] = [];
  const decided = new Map(input.decisions.map((entry) => [entry.item_id, entry.decision]));
  for (const entry of input.decisions) {
    const line = byId.get(entry.item_id)!;
    const stored = readOfferTreatment(line.source_metadata);
    const previous = stored.state === "read" && stored.treatment.kind === "offer_reserve" ? stored.treatment.sentence : null;
    if (entry.decision?.kind === "offer_reserve") {
      const sentence = buildOfferReserveSentence(line.title, entry.decision.text);
      if (previous !== null && previous !== sentence) remove.push(previous);
      add.push(sentence);
      treatments.push({ item_id: line.id, treatment: { kind: "offer_reserve", basis: entry.decision.basis,
        text: entry.decision.text, sentence } });
    } else {
      if (previous !== null) remove.push(previous);
      treatments.push({ item_id: line.id, treatment: entry.decision === null ? null
        : { kind: "internal_exclusion", reason_code: entry.decision.reason_code, note: entry.decision.note } });
    }
  }

  // One estimate answers one consultation: the reserves that hold after this save rest on one basis.
  const bases = new Set<OfferReserveBasis>();
  for (const line of input.lines) {
    if (line.item_type !== "line") continue;
    if (decided.has(line.id)) {
      const decision = decided.get(line.id);
      if (decision?.kind === "offer_reserve") bases.add(decision.basis);
      continue;
    }
    const kept = effectiveOfferTreatment(line.source_metadata, line.pricing_status);
    if (kept?.kind === "offer_reserve") bases.add(kept.basis);
  }
  if (bases.size > 1) {
    return { ok: false, refusal: { code: "OFFER_RESERVE_BASIS_CONFLICT", bases: [...bases].sort() } };
  }

  // A sentence still in use by another reserve of the same title and text is not taken out.
  const stillUsed = new Set(add);
  for (const line of input.lines) {
    if (decided.has(line.id)) continue;
    const kept = effectiveOfferTreatment(line.source_metadata, line.pricing_status);
    if (kept?.kind === "offer_reserve") stillUsed.add(kept.sentence);
  }
  const exclusions = rewriteOfferLimitsText(input.exclusions,
    { remove: remove.filter((sentence) => !stillUsed.has(sentence)), add });
  if ((exclusions?.length ?? 0) > OFFER_LIMITS_TEXT_MAX_LENGTH) {
    return { ok: false, refusal: { code: "OFFER_LIMITS_TEXT_TOO_LONG", length: exclusions!.length } };
  }
  return { ok: true, treatments, exclusions };
}

/** « Devis privé » or its sibling, for the messages that name the basis already in use. */
export function describeOfferReserveBases(bases: readonly OfferReserveBasis[]): string {
  return bases.map((basis) => `« ${OFFER_RESERVE_BASIS_LABELS[basis]} »`).join(" et ");
}
