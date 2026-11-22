import { z } from "zod";

import { forcedItemSchema, forcedJustificationSchema } from "@/lib/takeoff/schemas";
import { TAKEOFF_RULE_IDS } from "@/lib/takeoff/rules/types";
import { takeoffPageDecisionSchema, takeoffPageReplacementResponseSchema } from "@/lib/takeoff/page-replacement-contracts";

// Lot 2, M2: « Envoyer au tableau de chiffrage » for a takeoff of an affaire, which may have no estimate yet. The preview
// writes nothing: it is the very send run and rolled back, so it shows the lines as the estimate would hold them. The
// confirmation sends what the preview showed (its fingerprint, its outcome) or is refused and asked again.

const uuid = z.string().uuid();

/** Where the lines go: the first draft created by the confirmation, a draft of the affaire, or a copy of an issued version. */
export const takeoffSendDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("first_draft") }).strict(),
  z.object({ kind: z.literal("existing_draft"), version_id: uuid }).strict(),
  z.object({ kind: z.literal("version_copy"), source_version_id: uuid }).strict(),
]);
export type TakeoffSendDestination = z.infer<typeof takeoffSendDestinationSchema>;

/** A new section of the created version (or of the draft), or a section of the draft. */
export const takeoffSendSectionChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new") }).strict(),
  z.object({ kind: z.literal("existing"), id: uuid }).strict(),
]);
export type TakeoffSendSectionChoice = z.infer<typeof takeoffSendSectionChoiceSchema>;

export const takeoffSendPreviewRequestSchema = z.object({
  destination: takeoffSendDestinationSchema.optional(),
  section: takeoffSendSectionChoiceSchema.optional(),
  /** The member's decisions on the pages already in the estimate: the outcome shown depends on them. */
  page_decisions: z.array(takeoffPageDecisionSchema).max(2000).optional(),
}).strict();
export type TakeoffSendPreviewRequest = z.infer<typeof takeoffSendPreviewRequestSchema>;

export const takeoffSendRequestSchema = z.object({
  /** One per confirmation, kept by the screen across a timeout: a replay returns the receipt. */
  request_id: uuid,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  destination: takeoffSendDestinationSchema,
  section: takeoffSendSectionChoiceSchema,
  page_decisions: z.array(takeoffPageDecisionSchema).max(2000).default([]),
  // An administrator's override of the blocked lines, as « Envoyer au tableau de chiffrage » forces them (TI-686 D10).
  override: z.boolean().optional(),
  forced_justifications: z.array(forcedJustificationSchema).min(1).optional(),
  forced_items: z.array(forcedItemSchema).min(1).optional(),
}).strict().superRefine((payload, ctx) => {
  const forced = payload.forced_items !== undefined && payload.forced_justifications !== undefined;
  if ((payload.override === true) !== forced) {
    ctx.addIssue({ code: "custom", message: "Un forçage porte ses motifs et ses justifications, et seulement lui.", path: ["override"] });
  }
});
export type TakeoffSendRequest = z.infer<typeof takeoffSendRequestSchema>;

export const TAKEOFF_SEND_BLOCKERS = [
  "not_completed", "already_sent", "no_line", "dpgf_reconciliation_required", "copy_pages_already_in_estimate",
  "preparation_already_sent", "choose_destination", "read_only", "rules_unbounded", "draft_locked",
  // Sent by the previous server only (#448: the send of one analysis per plan was closed); accepted so that a page of this
  // application reading a preview from that server during a deployment still shows its message.
  "plan_send_pending",
] as const;
export type TakeoffSendBlocker = (typeof TAKEOFF_SEND_BLOCKERS)[number];

const destinationOptionSchema = z.object({
  destination: takeoffSendDestinationSchema,
  label: z.string(),
  /** Why this destination cannot be confirmed as it is, or null. */
  blocked: z.enum(TAKEOFF_SEND_BLOCKERS).nullable(),
}).strict();

const lineTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new_line") }).strict(),
  z.object({ kind: z.literal("existing_line"), estimate_item_id: uuid, title: z.string(), quantity_before: z.number(),
    quantity_after: z.number() }).strict(),
]);

/**
 * A line of the estimate as the send leaves it (the outcome of its dry run): created, changed (its quantity before and
 * after) or removed by a page decision, in its section, with its unit and quantity as written (a length rounded up once,
 * equal lengths grouped into one line) and the takeoff lines it holds.
 */
export const takeoffSendEstimateLineSchema = z.object({
  change: z.enum(["created", "changed", "removed"]),
  section_title: z.string().nullable(),
  title: z.string(),
  unit: z.string().nullable(),
  quantity: z.number(),
  quantity_before: z.number().nullable(),
  unit_price_ht_cents: z.number().int().nullable(),
  takeoff_item_ids: z.array(uuid),
}).strict();
export type TakeoffSendEstimateLine = z.infer<typeof takeoffSendEstimateLineSchema>;

/**
 * Lot 3: the send of one plan of a request read plan by plan, while its other plans may still be read. The plan sent;
 * the other plans of the affaire already read, which its controls compared it with; the plans of its request not read
 * yet, each in its state, the dossier's plans never read and the readings not compared (never covered by the controls,
 * never shown as checked); and the plan's location as an operator set it (its generation), the level a page without one
 * of its own is compared under. Null for any other takeoff (a grouped or standalone analysis is sent as lot 2 sends it).
 */
export const takeoffSendPlanScopeSchema = z.object({
  request_id: uuid,
  plan_name: z.string().nullable(),
  location: z.object({ building: z.string().nullable(), level: z.string().nullable(), generation: z.number().int().positive() })
    .strict().nullable(),
  /** Each reading compared: its plan, when it was read, and whether it comes from an earlier request. */
  compared: z.array(z.object({ job_id: uuid, plan_name: z.string().nullable(), read_at: z.string().nullable(),
    earlier_request: z.boolean() }).strict()),
  /** The units of this request not read; for a plan whose earlier reading is compared, when that reading was made. */
  unread: z.array(z.object({ plan_name: z.string().nullable(),
    state: z.enum(["queued", "running", "failed", "canceled", "not_started"]), compared_reading_at: z.string().nullable() }).strict()),
  /** The dossier's plans no analysis of one plan has read at their current copy (outside this request): not compared. */
  never_read: z.array(z.string().nullable()),
  /** Analyses of the affaire read and not sent that nothing compares with this plan: lot 2's grouped ones, those outside any request. */
  uncompared: z.object({ grouped: z.number().int().nonnegative(), outside_request: z.number().int().nonnegative() }).strict(),
  /** Pages of this plan whose own level contradicts the one an operator set for its revision: each keeps its own level. */
  level_contradictions: z.array(z.object({ source_file_name: z.string().nullable(), source_page: z.number().int(),
    read_level: z.string(), operator_level: z.string() }).strict()),
}).strict();
export type TakeoffSendPlanScope = z.infer<typeof takeoffSendPlanScopeSchema>;

const ruleFailureSchema = z.object({ rule: z.enum(TAKEOFF_RULE_IDS), code: z.string(), reason: z.string(), acceptable: z.boolean() }).strict();
const guardReasonSchema = z.enum(["low_confidence", "missing_evidence", "missing_source_page", "rule_failed", "rules_stale"]);

export const takeoffSendPreviewResponseSchema = z.object({
  job_id: uuid,
  /** The state this preview was computed from, and what it shows: the confirmation sends it back. */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  destinations: z.array(destinationOptionSchema),
  /** Null when several destinations are plausible: the user chooses. */
  destination: takeoffSendDestinationSchema.nullable(),
  destination_label: z.string().nullable(),
  section: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new"), title: z.string() }).strict(),
    z.object({ kind: z.literal("existing"), id: uuid, title: z.string() }).strict(),
  ]).nullable(),
  section_options: z.array(z.object({ id: uuid, label: z.string() }).strict()),
  new_section_title: z.string(),
  blocked: z.object({ reason: z.enum(TAKEOFF_SEND_BLOCKERS), message: z.string() }).strict().nullable(),
  engine: z.number().int().min(1).max(3).nullable(),
  lines: z.array(z.object({
    takeoff_item_id: uuid, designation: z.string(), quantity: z.number(), unit: z.string(),
    source_file_name: z.string().nullable(), source_page: z.number().int().nullable(), renamed_from: z.string().nullable(),
    target: lineTargetSchema,
  }).strict()),
  left_out: z.array(z.object({ takeoff_item_id: uuid, designation: z.string(), reason: z.enum(["excluded", "rule_skip"]),
    rule_name: z.string().nullable() }).strict()),
  /** Mapping rules that would set a price or fold lines into an ouvrage: without effect here (prices are never touched). */
  price_rules_ignored: z.array(z.object({ takeoff_item_id: uuid, designation: z.string(), rule_name: z.string().nullable(),
    action: z.enum(["set_price", "apply_assembly"]) }).strict()),
  reservations: z.array(z.object({ takeoff_item_id: uuid, designation: z.string(),
    kind: z.enum(["entered_hypothesis", "estimated", "non_observable", "entered", "to_review"]) }).strict()),
  /**
   * The estimate's lines as this send leaves them, computed by its dry run; null until it can run (pages to decide,
   * lines blocked for this member) — `outcome_pending` says why, and nothing can be confirmed meanwhile.
   */
  estimate_lines: z.array(takeoffSendEstimateLineSchema).nullable(),
  outcome_pending: z.enum(["page_decisions", "blocked"]).nullable(),
  /** The controls evaluated for this destination: the cross-takeoff controls are no longer deferred. */
  controls: z.object({
    /** Null when no control between takeoffs ran (`not_evaluated_reason` says why): never shown as checked. */
    evaluated_for: z.enum(["first_draft", "existing_draft", "version_copy"]).nullable(),
    not_evaluated_reason: z.enum(["no_rule_inputs"]).nullable(),
    /**
     * Each control between takeoffs, for this destination: evaluated when it ran for a line of this takeoff (zone
     * duplicates, zone coverage), else not evaluated. Null without a destination.
     */
    cross_takeoff: z.object({ duplicates: z.enum(["evaluated", "not_evaluated"]), coverage: z.enum(["evaluated", "not_evaluated"]) })
      .strict().nullable(),
    blocked_items: z.array(z.object({ item_id: uuid, designation: z.string(), confidence: z.number().nullable(),
      is_verified: z.boolean(), reasons: z.array(guardReasonSchema), rule_failures: z.array(ruleFailureSchema).optional() }).strict()),
    medium_items: z.array(z.object({ item_id: uuid, designation: z.string(), confidence: z.number().nullable(),
      rule_failures: z.array(ruleFailureSchema).optional(), source_page: z.number().int().nullable().optional(),
      source_file_name: z.string().nullable().optional() }).strict()),
    threshold: z.number(),
  }).strict(),
  page_proposal: takeoffPageReplacementResponseSchema.nullable(),
  /** Absent for a grouped or standalone analysis (the shape a previous page expects), and from a previous server. */
  plan_scope: takeoffSendPlanScopeSchema.optional(),
  impact: z.object({ sent_count: z.number().int().nonnegative(), accumulated_count: z.number().int().nonnegative(),
    version_created: z.boolean(), section_created: z.boolean() }).strict(),
}).strict();
export type TakeoffSendPreviewResponse = z.infer<typeof takeoffSendPreviewResponseSchema>;

export const takeoffSendResponseSchema = z.object({
  job_id: uuid,
  receipt_id: uuid,
  request_id: uuid,
  replayed: z.boolean(),
  version_id: uuid,
  version_created: z.boolean(),
  created_count: z.number().int().nonnegative(),
  updated_count: z.number().int().nonnegative(),
  removed_count: z.number().int().nonnegative(),
  ignored_count: z.number().int().nonnegative(),
  lines_created: z.array(uuid),
  lines_updated: z.array(uuid),
  lines_removed: z.array(uuid),
  sections_changed: z.array(uuid),
}).strict();
export type TakeoffSendResponse = z.infer<typeof takeoffSendResponseSchema>;
