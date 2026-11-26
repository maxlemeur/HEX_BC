import { z } from "zod";

export const measureRefusals = {
  answer_changed: "La lecture de ce poste a changé. Rouvrez son détail.",
  sent: "Ce plan a déjà été envoyé. Ouvrez le reçu pour réviser son apport.",
  coverage_incomplete: "Attendez la fin de la lecture ou reprenez la lecture incomplète.",
  not_measured: "Relisez le plan ou renseignez une saisie justifiée pour un poste incertain ou non trouvé.",
  entered: "Une quantité est déjà saisie. Vérifiez sa portée et son inclusion dans le devis.",
  quantity_choice: "Choisissez la source de quantité dans le détail du comptage.",
  already_decided: "Une décision existe sur ce plan. Rétablissez d’abord un poste écarté.",
  unit_conflict: "Corrigez les unités des contributions et recalculez les contrôles.",
  missing_evidence: "Renseignez la preuve et sa page dans la revue de ligne ou relisez le plan.",
  rules_stale: "Recalculez les contrôles du plan puis rouvrez le poste.",
  unit_mismatch: "Corrigez l’unité de la contribution puis recalculez les contrôles.",
  alert: "Réexaminez les contributions écartées. Pour modifier un constat de la lecture publiée, relisez le plan.",
  hypothesis: "Une hypothèse se traite par une saisie justifiée et son inclusion individuelle.",
  rule_not_acceptable: "Corrigez la contribution en échec puis recalculez les contrôles.",
  rule_without_coded_justification: "Ce contrôle ne dispose pas de justification recevable. Corrigez la contribution.",
  justification_required: "Justifiez chaque contribution signalée dans la revue de ligne.",
  gap_confirmation_required: "Confirmez l’écart à la DPGF.",
  rules_confirmation_required: "Confirmez les justifications des contrôles en échec.",
  proof_confirmation_required: "Confirmez la vérification de la preuve.",
} as const;

export const measureReasonSchema = z.enum(Object.keys(measureRefusals) as [keyof typeof measureRefusals, ...(keyof typeof measureRefusals)[]]);
const revision = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z.string().uuid();

export const retainCommandSchema = z.object({
  intent_key: uuid,
  acknowledgement: z.object({ revision, gap_checked: z.boolean(), rules_checked: z.boolean(), proof_checked: z.boolean() }).strict(),
}).strict();

export const measureReviewSchema = z.object({
  answer_id: uuid, item_id: uuid, plan_id: uuid, revision, quantity: z.number().nullable(), unit: z.string().nullable(),
  reference: z.number().nullable(), expected_unit: z.string().nullable(), gap: z.number().nullable(), confidence_threshold: z.number(),
  reason: measureReasonSchema.nullable(), gap_required: z.boolean(), rules_required: z.boolean(), proof_required: z.boolean(),
  decision_revision: z.number().int().nonnegative(),
  effective_decision: z.enum(["accepted", "set_aside"]).nullable(),
  previously_retained: z.boolean(),
  retained: z.object({ quantity: z.number(), unit: z.string() }).strict().nullable(),
  rows: z.array(z.object({
    id: uuid.nullable(), observation_id: uuid, failures: z.array(z.string()), justification: z.array(z.string()),
    page: z.number().int().nullable(), evidence: z.string().nullable(), quantity: z.number().nullable(),
    unit: z.string().nullable(), confidence: z.number().nullable(),
    author: z.string().nullable(), needs_justification: z.boolean(), low_confidence: z.boolean(),
  }).strict()),
}).strict();
export type MeasureReview = z.infer<typeof measureReviewSchema>;
export const retainedMeasureSchema = z.object({ outcome: z.literal("applied"), command_id: uuid, item_id: uuid,
  answer_id: uuid, replayed: z.boolean() }).strict();
