import { z } from "zod";

// TI-682 lot D, PR 2: the proposal of the « Pages déjà au devis » step (what re-measuring each page would replace) and
// the decisions the estimator sends with the application (public.record_takeoff_page_decisions, then the guard).

const uuid = z.string().uuid();

export const TAKEOFF_PAGE_KEEP_BOTH_REASONS = ["other_zone", "other_trade", "complementary_scope"] as const;
export type TakeoffPageKeepBothReason = (typeof TAKEOFF_PAGE_KEEP_BOTH_REASONS)[number];
export const TAKEOFF_PAGE_KEEP_BOTH_REASON_LABELS: Record<TakeoffPageKeepBothReason, string> = {
  other_zone: "Autre zone de la même feuille",
  other_trade: "Autre lot ou corps d’état",
  complementary_scope: "Périmètre complémentaire",
};
/** A complementary scope says what it adds: 10 to 500 characters, as the justifications of forced lines. */
export const TAKEOFF_PAGE_NOTE_MIN = 10;
export const TAKEOFF_PAGE_NOTE_MAX = 500;

const documentSchema = z.object({
  plan_file_id: uuid.nullable(),
  content_hash: z.string().nullable(),
  logical_document_id: z.string().nullable(),
  file_name: z.string().nullable(),
}).strict();

export const takeoffPageDecisionSchema = z.object({
  document: documentSchema,
  source_page: z.number().int().positive().nullable(),
  earlier_job_ids: z.array(uuid).max(100),
  decision: z.enum(["replace", "keep_both"]),
  reason_code: z.enum(TAKEOFF_PAGE_KEEP_BOTH_REASONS).nullable(),
  note: z.string().trim().max(TAKEOFF_PAGE_NOTE_MAX).nullable(),
  lines: z.array(z.object({
    estimate_item_id: uuid,
    expected_updated_at: z.string().min(1).max(64),
    action: z.enum(["update", "remove", "keep"]),
    take: z.enum(["new", "keep_mine"]).nullable(),
    item_ids: z.array(uuid).max(5000),
  }).strict()).min(1).max(5000),
  pairs: z.array(z.object({ takeoff_item_id: uuid, estimate_item_id: uuid }).strict()).max(5000),
}).strict().superRefine((decision, ctx) => {
  if (decision.decision === "keep_both") {
    if (!decision.reason_code) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choisissez le motif pour garder les deux mesures.", path: ["reason_code"] });
    if (decision.reason_code === "complementary_scope" && (decision.note?.length ?? 0) < TAKEOFF_PAGE_NOTE_MIN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Décrivez le périmètre complémentaire (10 caractères au moins).", path: ["note"] });
    }
    if (decision.pairs.length > 0 || decision.lines.some((line) => line.action !== "keep")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Garder les deux mesures garde chaque ligne précédente.", path: ["lines"] });
    }
  } else if (decision.reason_code !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Un remplacement n’a pas de motif.", path: ["reason_code"] });
  }
});
export type TakeoffPageDecision = z.infer<typeof takeoffPageDecisionSchema>;
export const takeoffPageDecisionsSchema = z.array(takeoffPageDecisionSchema).max(2000);

export const takeoffPageReplacementRequestSchema = z.object({
  strategy: z.enum(["append", "merge", "replace"]),
  target_section_id: uuid.nullable().optional(),
  // The mapping overrides of the wizard's preview, so that the lines it skips or folds into an ouvrage are left out.
  overrides: z.array(z.unknown()).max(5000).optional(),
}).strict();
export type TakeoffPageReplacementRequest = z.infer<typeof takeoffPageReplacementRequestSchema>;

const newLineSchema = z.object({
  id: uuid,
  designation: z.string(),
  unit: z.string(),
  quantity: z.number(),
  /** The unit the database compares (a code or a status mention); null when the referential does not know it. */
  unit_key: z.string().nullable(),
}).strict();
const earlierLineSchema = z.object({
  id: uuid,
  title: z.string(),
  unit_key: z.string(),
  quantity: z.number().nullable(),
  /** What its sources give (rounded once for a length); the estimator changed the quantity by hand when it differs. */
  measured_quantity: z.number().nullable(),
  changed_by_hand: z.boolean(),
  updated_at: z.string(),
  unit_price_ht_cents: z.number().int().nullable(),
  job_id: uuid,
  /** A DPGF target: its own policy replaces it; it is only kept or replaced by the DPGF reconciliation. */
  dpgf_target: z.boolean(),
  /** Its earlier source lines on this page (none for an engine 1/2 line). */
  item_ids: z.array(uuid),
  /** Every source line with its quantity, to show what a replacement gives. */
  sources: z.array(z.object({ id: uuid, quantity: z.number() }).strict()),
  length_factor: z.number().nullable(),
}).strict();
export const takeoffPageReplacementRowSchema = z.object({
  key: z.string(),
  document: documentSchema,
  file_name: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  earlier_job_ids: z.array(uuid).min(1),
  new_lines: z.array(newLineSchema),
  earlier_lines: z.array(earlierLineSchema).min(1),
  pairs: z.array(z.object({
    takeoff_item_id: uuid,
    estimate_item_id: uuid,
    source_item_id: uuid.nullable(),
    reason: z.enum(["same_designation", "same_network", "similar_designation", "merge"]),
    /** Imposed by « Fusionner » on a DPGF version: the estimator cannot undo it. */
    locked: z.boolean(),
  }).strict()),
  /** A new line known only by its name meets two identified documents of that name here: no pair across them. */
  ambiguous_document: z.boolean(),
  /** Why keeping both is refused on this page, if it is: its new lines feed a DPGF target another takeoff fed. */
  keep_both_refused: z.enum(["dpgf_target"]).nullable(),
}).strict();
export type TakeoffPageReplacementRow = z.infer<typeof takeoffPageReplacementRowSchema>;

export const takeoffPageReplacementResponseSchema = z.object({
  job_id: uuid,
  /** The version the application writes into: the takeoff's own. */
  version_id: uuid,
  rows: z.array(takeoffPageReplacementRowSchema),
  jobs: z.array(z.object({ id: uuid, created_at: z.string(), level: z.string().nullable(), source_file_name: z.string().nullable() }).strict()),
  /** This takeoff's lines that read no known plan nor page: compared to nothing. */
  unidentified_count: z.number().int().nonnegative(),
  /** The version has DPGF lines: « Fusionner » is required and its pairs are imposed. */
  merge_required: z.boolean(),
}).strict();
export type TakeoffPageReplacementResponse = z.infer<typeof takeoffPageReplacementResponseSchema>;
