import { z } from "zod";

import { ITEM_SEND_BREAKDOWNS, ITEM_SEND_KEEP_BOTH_REASONS } from "@/lib/takeoff/item-send-plan";

// Lot 4, PR 5a/5b: the read-only preview of the send of one plan's answers by item (POST /api/takeoff/jobs/{jobId}/
// item-send/preview), which shows what the estimate would become and writes nothing, and its confirmation (POST …/
// item-send/confirm), which sends the same request with the member's page decisions, the digest of the plan shown and
// an intention key: the server computes the plan again from the stored facts and the writer applies it.

const uuid = z.string().uuid();

export const itemSendDestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("first_draft") }).strict(),
  z.object({ kind: z.literal("existing_draft"), version_id: uuid }).strict(),
]);

export const itemSendChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), estimate_item_id: uuid }).strict(),
  z.object({ kind: z.literal("new_line") }).strict(),
  z.object({ kind: z.literal("keep_entry") }).strict(),
  z.object({ kind: z.literal("use_retained") }).strict(),
  z.object({ kind: z.literal("leave_out") }).strict(),
]);

const pageSchema = z.number().int().positive().max(999_999_999).nullable();
/**
 * A page held, decided at the confirmation: « Remplacer », or « Garder les deux » with its reason (a complementary scope
 * says why in a note of 10 to 500 characters). Null page: a part whose page is unknown, on every page.
 */
export const itemSendPageDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ page: pageSchema, decision: z.literal("replace") }).strict(),
  z.object({ page: pageSchema, decision: z.literal("keep_both"), reason_code: z.enum(ITEM_SEND_KEEP_BOTH_REASONS),
    note: z.string().max(500).nullable().optional() }).strict()
    .refine((value) => value.reason_code !== "complementary_scope" || (value.note ?? "").trim().length >= 10,
      { message: "« Garder les deux » pour un périmètre complémentaire demande une note de 10 caractères au moins.", path: ["note"] }),
]);

export const itemSendPreviewRequestSchema = z.object({
  destination: itemSendDestinationSchema.optional(),
  breakdown: z.enum(ITEM_SEND_BREAKDOWNS).optional(),
  /** The member's explicit choices, each by the key of the point to resolve the preview gave. */
  resolutions: z.array(z.object({ key: z.string().min(1).max(400), choice: itemSendChoiceSchema }).strict()).max(2000).optional(),
  /** The page decisions the confirmation takes, each on a page the preview names as held; one per page. */
  page_decisions: z.array(itemSendPageDecisionSchema).max(2000).optional()
    .refine((value) => !value || new Set(value.map((entry) => entry.page ?? "all")).size === value.length,
      { message: "Une seule décision par page." }),
}).strict();
export type ItemSendPreviewRequest = z.infer<typeof itemSendPreviewRequestSchema>;

/**
 * The confirmation: the preview's request as the member confirmed it, its intention key (the same key and the same plan
 * answer the same receipt; another plan under it is a conflict) and the digest of the plan the preview showed (another
 * plan computed now refuses the confirmation: nothing is written, the preview is shown again).
 */
export const itemSendConfirmRequestSchema = itemSendPreviewRequestSchema.extend({
  request_id: uuid,
  plan_digest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type ItemSendConfirmRequest = z.infer<typeof itemSendConfirmRequestSchema>;

export const ITEM_SEND_BLOCKERS = ["not_completed", "already_sent", "read_only", "choose_destination", "issued_only", "engine_not_v3",
  "engine_policy_v2", "dpgf_import_required", "no_line"] as const;
export const ITEM_SEND_NOT_SENT_REASONS = ["set_aside", "not_accepted", "not_found", "uncertain", "empty", "unit_incompatible",
  "hypothesis_not_included", "rule_skip", "affaire_entry", "no_answer", "left_out", "entry_suspended", "superseded"] as const;
export const ITEM_SEND_TO_RESOLVE_KINDS = ["target_missing", "target_multiple", "identity_conflict", "entered_quantity",
  "breakdown_mixed", "page_decision", "section_depth", "quantity_unwritable", "compartment_changed", "verified_total_indivisible"] as const;
export const ITEM_SEND_INVALID_DECISIONS = ["page_not_held", "replace_not_cuttable", "keep_both_same_line", "part_indivisible",
  "part_elsewhere"] as const;
const ruleActions = ["none", "rename", "set_category", "skip", "set_price", "apply_assembly"] as const;
const ruleEffects = ["none", "renamed", "categorized", "skipped", "price_ignored", "assembly_indicated"] as const;

const quantitySourceSchema = z.enum(["measured", "entered", "verified_count"]);
export const itemSendCountTotalSchema = z.object({
  job_id: uuid, answer_id: uuid.nullable(), reading_revision: z.number().int().positive().nullable(),
  marks_revision: z.number().int().positive(), quantity: z.number().int().positive(), unit: z.string(),
  pages: z.array(z.number().int().positive()),
});
const gapSchema = z.object({ absolute: z.number(), percent: z.number().nullable(), requires_review: z.boolean() }).strict();
const optionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), estimate_item_id: uuid, title: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("new_line") }).strict(),
  z.object({ kind: z.literal("keep_entry") }).strict(),
  z.object({ kind: z.literal("use_retained") }).strict(),
  z.object({ kind: z.literal("leave_out") }).strict(),
]);

export const itemSendPreviewResponseSchema = z.object({
  job_id: uuid,
  /** Null for a member who cannot write the affaire: the reason only, nothing of the takeoff. */
  plan: z.object({ key: z.string(), name: z.string() }).strict().nullable(),
  list: z.object({ revision_id: uuid, revision: z.number().int().positive() }).strict().nullable(),
  destinations: z.array(z.object({ destination: itemSendDestinationSchema.nullable(), label: z.string(),
    blocked: z.enum(ITEM_SEND_BLOCKERS).nullable() }).strict()),
  destination: itemSendDestinationSchema.nullable(),
  destination_label: z.string().nullable(),
  /** The confirmation would create the affaire's first draft (V1): nothing exists before it. */
  version_created: z.boolean(),
  engine: z.number().int().nullable(),
  breakdown: z.enum(ITEM_SEND_BREAKDOWNS),
  blocked: z.object({ reason: z.enum(ITEM_SEND_BLOCKERS), message: z.string(),
    /** Where to act instead: the confirmed import of the DPGF, for a draft without its lines. */
    href: z.string().nullable() }).strict().nullable(),
  sections: z.array(z.object({ key: z.string(), title: z.string(), parent_key: z.string().nullable(), depth: z.number().int().positive(),
    homonym_in_draft: z.boolean() }).strict()),
  lines: z.array(z.object({
    key: z.string(),
    item_id: uuid,
    label: z.string(),
    change: z.enum(["created", "fed"]),
    target: z.enum(["dpgf_line", "earlier_line", "new_line"]),
    estimate_item_id: uuid.nullable(),
    title: z.string().nullable(),
    section_key: z.string().nullable(),
    compartment: z.object({ key: z.string(), label: z.string(), reason: z.enum(["location_unknown", "location_multiple", "location_to_confirm"])
      .nullable() }).strict(),
    unit: z.string(),
    quantity_source: quantitySourceSchema.optional(),
    replaced_verified_total: itemSendCountTotalSchema.optional(),
    quantity_before: z.number().nullable(),
    quantity_after: z.number(),
    reference: z.number().nullable(),
    entered: z.number().nullable(),
    earlier: z.number(),
    /** What this plan had already brought to the line: replaced by this send (a revision of the plan's part), never added to. */
    replaced: z.number(),
    added: z.number(),
    measured: z.number(),
    retained: z.number(),
    rounded_from: z.number().nullable(),
    gap: gapSchema.nullable(),
    kept_entry: z.boolean(),
    pages: z.array(z.number().int().positive()),
    rule: z.object({ name: z.string().nullable(), effect: z.enum(ruleEffects) }).strict().nullable(),
  }).strict()),
  not_sent: z.array(z.object({ item_id: uuid, label: z.string(), reason: z.enum(ITEM_SEND_NOT_SENT_REASONS), message: z.string() }).strict()),
  /** Every part of an answer that does not enter the estimate, with its observations, pages and quantity. */
  parts_not_sent: z.array(z.object({ item_id: uuid, kind: quantitySourceSchema, observation_ids: z.array(z.string()),
    pages: z.array(z.number().int().positive()), quantity: z.number(), unit: z.string().nullable(),
    reason: z.enum(["page_held", ...ITEM_SEND_NOT_SENT_REASONS]), message: z.string() }).strict()),
  to_resolve: z.array(z.object({
    key: z.string(),
    kind: z.enum(ITEM_SEND_TO_RESOLVE_KINDS),
    verified_total: itemSendCountTotalSchema.optional(),
    item_id: uuid.nullable(),
    label: z.string().nullable(),
    page: z.number().int().positive().nullable(),
    held_item_ids: z.array(uuid),
    /** The estimate's lines already on a page waiting for its decision; for a quantity typed by hand, the line typed. */
    earlier_lines: z.array(z.object({ estimate_item_id: uuid, title: z.string().nullable(), quantity: z.number() }).strict()),
    message: z.string(),
    options: z.array(optionSchema),
    facts: z.object({ reference: z.number().nullable(), entered: z.number().nullable(), measured: z.number(), retained: z.number() })
      .strict().nullable(),
  }).strict()),
  /** Readings kept and never added: another reading of an object already counted, or an indication that is not a measure. */
  not_added: z.array(z.object({ item_id: uuid, role: z.enum(["alternative", "candidate"]), quantity: z.number().nullable(),
    unit: z.string().nullable(), page: z.number().int().positive().nullable() }).strict()),
  page_contributions: z.array(z.object({ page: z.number().int().positive(), item_ids: z.array(uuid) }).strict()),
  /** Page decisions the writer would refuse, with the member's reason: nothing is written while one is listed. */
  invalid_page_decisions: z.array(z.object({ page: z.number().int().positive().nullable(), reason: z.enum(ITEM_SEND_INVALID_DECISIONS),
    message: z.string() }).strict()),
  rules: z.array(z.object({ item_id: uuid, label: z.string(), rule_name: z.string().nullable(), action: z.enum(ruleActions),
    effect: z.enum(ruleEffects), message: z.string(),
    /** The ouvrage a « Remplacer par un ouvrage » rule points to: an indication, never inserted nor priced. */
    assembly: z.object({ id: uuid, name: z.string().nullable() }).strict().nullable() }).strict()),
  confirmable: z.boolean(),
  /** The line the editor would open on: the first line fed in document order; a line to create is named once created. */
  focus_item_id: uuid.nullable(),
  /** The digest of the write plan this preview computed, null until it can be confirmed. */
  plan_digest: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
}).strict();
export type ItemSendPreviewResponse = z.infer<typeof itemSendPreviewResponseSchema>;

/** What the confirmation wrote, from its receipt: the same answer for the same intention key, replayed. */
export const itemSendConfirmResponseSchema = z.object({
  receipt_id: uuid,
  replayed: z.boolean(),
  job_id: uuid,
  version_id: uuid,
  version_created: z.boolean(),
  lines_written: z.number().int().nonnegative(),
  parts_written: z.number().int().nonnegative(),
  parts_replaced: z.number().int().nonnegative(),
  /** The line the editor opens on: the first line written, else the first section created. */
  focus_item_id: uuid.nullable(),
}).strict();
export type ItemSendConfirmResponse = z.infer<typeof itemSendConfirmResponseSchema>;
