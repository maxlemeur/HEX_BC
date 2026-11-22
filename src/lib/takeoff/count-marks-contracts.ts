import { z } from "zod";

import {
  TAKEOFF_COUNT_MARK_REMOVAL_REASONS,
  TAKEOFF_COUNT_MARK_STATES,
  TAKEOFF_COUNT_MARK_SUMMARY_STATES,
} from "@/lib/takeoff/count-marks";
import {
  takeoffResponseCountSchema as count,
  takeoffResponseTimestampSchema as timestamp,
  takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

/**
 * The routes of the counted marks of an affaire's items (lot 5), as the detail of an item on its plan calls them:
 * GET /api/affaires/{projectId}/takeoff/count-marks (the marks of one answer on one page, paged, with the server's count
 * and what the member may do), POST on the same path (the edit command: N gestures under the expected revisions, an
 * intention key) and GET …/count-marks/history (the journal of an answer's marks, paged). The database decides every
 * gesture again (public.edit_takeoff_count_marks); the route adds one refusal of its own, a plan already sent.
 */

const page = z.number().int().min(1).max(100_000);
const unit = z.number().finite().min(0).max(1);
const box = z.tuple([unit, unit, unit, unit]).readonly();

/** The refusal of the route itself, before the command: the answer's plan was sent to an estimate (its job applied). */
export const TAKEOFF_COUNT_MARKS_PLAN_SENT = "TAKEOFF_MARKS_PLAN_SENT";
export const TAKEOFF_COUNT_MARKS_PLAN_SENT_MESSAGE =
  "Ce plan a déjà été envoyé au devis : ses repères se consultent ici, une correction passera par une révision de l’apport.";

/** Why the member may only read the marks shown: no operator right, a plan already sent, or a later reading. */
export const TAKEOFF_COUNT_MARKS_READ_ONLY_REASONS = ["forbidden", "sent", "replaced"] as const;
export type TakeoffCountMarksReadOnlyReason = (typeof TAKEOFF_COUNT_MARKS_READ_ONLY_REASONS)[number];

export const TAKEOFF_COUNT_MARKS_READ_ONLY_LABELS: Record<TakeoffCountMarksReadOnlyReason, string> = {
  forbidden: "Lecture seule : un opérateur du métré de l’affaire peut corriger ces repères.",
  sent: TAKEOFF_COUNT_MARKS_PLAN_SENT_MESSAGE,
  replaced: "Une lecture plus récente de ce poste sur ce plan a remplacé celle-ci : ses repères se consultent seulement.",
};

export const COUNT_MARKS_PAGE_LIMIT = { default: 1000, max: 1000 } as const;
export const COUNT_MARKS_HISTORY_LIMIT = { default: 50, max: 100 } as const;

const states = z.enum(TAKEOFF_COUNT_MARK_STATES);

/** The query of the marks' reader; a parameter that cannot be read is refused (422), never guessed. */
export const countMarksQuerySchema = z.object({
  reponse: uuid,
  page: z.coerce.number().int().min(1).max(100_000),
  apres: uuid.optional(),
  etats: z.string().max(100).optional().transform((value, context) => {
    if (value === undefined) return undefined;
    const asked = [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
    const parsed = z.array(states).min(1).safeParse(asked);
    if (!parsed.success) {
      context.addIssue({ code: "custom", message: "États de repères invalides." });
      return z.NEVER;
    }
    return parsed.data;
  }),
  limite: z.coerce.number().int().min(1).max(COUNT_MARKS_PAGE_LIMIT.max).optional(),
}).strict();

export const countMarksHistoryQuerySchema = z.object({
  reponse: uuid,
  apresRevision: z.coerce.number().int().min(0).max(1_000_000).optional(),
  apresOrdre: z.coerce.number().int().min(0).max(100_000).optional(),
  limite: z.coerce.number().int().min(1).max(COUNT_MARKS_HISTORY_LIMIT.max).optional(),
}).strict();

const geometrySchema = z.object({
  version: z.literal(1),
  view_box: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).readonly(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  user_unit: z.number().finite().positive(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
}).strict();

const objectWord = z.literal("distinct").optional();
/** A retain or a restore: « same » names the retained mark it is the object of, « distinct » (or nothing) does not. */
const decided = <Op extends "restore" | "retain">(op: Op) => z.union([
  z.object({ op: z.literal(op), answer_id: uuid, mark_id: uuid, object: z.literal("same"), same_as: uuid }).strict(),
  z.object({ op: z.literal(op), answer_id: uuid, mark_id: uuid, object: z.literal("distinct").optional() }).strict(),
]);

/** One gesture of an edit, as public.edit_takeoff_count_marks takes it (it checks every field again). */
export const countMarkGestureSchema = z.union([
  z.object({ op: z.literal("add"), answer_id: uuid, key: uuid, page, x: unit, y: unit, box: box.optional(),
    geometry: geometrySchema.optional(), object: objectWord }).strict(),
  z.object({ op: z.literal("move"), mark_id: uuid, x: unit, y: unit, box: box.optional(), object: objectWord }).strict(),
  z.object({ op: z.literal("remove"), answer_id: uuid, mark_id: uuid, reason: z.enum(TAKEOFF_COUNT_MARK_REMOVAL_REASONS),
    note: z.string().trim().min(1).max(500).optional() }).strict(),
  decided("restore"),
  decided("retain"),
  z.object({ op: z.literal("reattribute"), answer_id: uuid, mark_id: uuid, to_answer_id: uuid, object: objectWord }).strict(),
  z.object({ op: z.literal("verify"), answer_id: uuid, pages: z.array(page).min(1).max(1000).readonly() }).strict(),
]);

export const countMarksEditRequestSchema = z.object({
  intentKey: uuid,
  revisions: z.record(uuid, z.number().int().min(0).max(1_000_000))
    .refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 50, "Entre 1 et 50 réponses."),
  gestures: z.array(countMarkGestureSchema).min(1).max(500),
}).strict();
export type CountMarksEditRequest = z.infer<typeof countMarksEditRequestSchema>;

const pageSummarySchema = z.object({
  page, proposed: count, toAttribute: count, retained: count, removed: count, pending: count, reread: count,
  changedRevision: count, verifiedRevision: count.nullable(), state: z.enum(TAKEOFF_COUNT_MARK_SUMMARY_STATES),
}).strict();

export const countMarkSummarySchema = z.object({
  revision: count,
  unit: z.string().nullable(),
  counted: z.boolean(),
  proposed: count,
  toAttribute: count,
  retained: count,
  removed: count,
  pending: count,
  reread: count,
  scopePages: count,
  verifiedPages: count,
  quantity: count.nullable().describe("Quantité retenue d’un poste compté en pièces, portée entière vérifiée ; null, jamais 0."),
  state: z.enum(TAKEOFF_COUNT_MARK_SUMMARY_STATES),
  pages: z.array(pageSummarySchema),
}).strict();

const numbers = (length: number) => z.array(z.number().finite()).length(length);

const proposalSchema = z.object({
  proposalId: uuid, answerId: uuid, jobId: uuid, observationId: uuid.nullable(), generation: count, sourceKey: z.string(),
  method: z.string(), methodVersion: z.string(), state: z.enum(["proposed", "to_attribute"]), x: z.number(), y: z.number(),
  box: numbers(4).nullable(), rawCentre: numbers(2).nullable(), rawBox: numbers(4).nullable(), rawFrame: z.string().nullable(),
  sourceRef: z.string().nullable(), subtype: z.string().nullable(), diameterMm: z.number().nullable(),
  diameterSource: z.string().nullable(), confidence: z.number().nullable(), publishedAt: timestamp,
}).strict();

const markSchema = z.object({
  markId: uuid,
  x: z.number(),
  y: z.number(),
  box: numbers(4).nullable(),
  origin: z.enum(["machine", "manual"]),
  positionRevision: count,
  createdBy: uuid.nullable(),
  createdJobId: uuid.nullable(),
  createdAt: timestamp,
  movedBy: uuid.nullable(),
  movedAt: timestamp.nullable(),
  state: states,
  priorState: states.nullable(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  decidedBy: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  possibleDuplicates: z.array(uuid),
  others: z.array(z.object({ answerId: uuid, itemId: uuid, state: states, revision: count }).strict()),
  proposals: z.array(proposalSchema),
}).strict();

export const countMarksViewSchema = z.object({
  answerId: uuid,
  page,
  revision: count.describe("Révision des repères de la réponse, à renvoyer avec une modification."),
  geometry: geometrySchema.extend({ plan_file_id: uuid, plan_generation: z.string().nullable() }).nullable()
    .describe("La page de preuve telle qu’enregistrée ; null tant qu’aucun repère n’y est posé."),
  total: count.describe("Total serveur des repères dans les états demandés, à part du nombre chargé."),
  loaded: count,
  nextAfter: uuid.nullable(),
  marks: z.array(markSchema),
  summary: countMarkSummarySchema,
  edit: z.object({ allowed: z.boolean(), reason: z.enum(TAKEOFF_COUNT_MARKS_READ_ONLY_REASONS).nullable() }).strict(),
  viewerId: uuid,
  names: z.record(uuid, z.string()),
}).strict();
export type CountMarksView = z.infer<typeof countMarksViewSchema>;

export const countMarksEditResultSchema = z.object({
  replayed: z.boolean(),
  commandId: uuid,
  revisions: z.record(uuid, count),
  added: z.array(z.object({ key: uuid, markId: uuid }).strict()),
  summaries: z.record(uuid, countMarkSummarySchema),
}).strict();
export type CountMarksEditResult = z.infer<typeof countMarksEditResultSchema>;

export const TAKEOFF_COUNT_MARK_EVENT_GESTURES = ["proposed", "add", "move", "remove", "restore", "retain", "reattribute_out",
  "reattribute_in", "verify", "same_object"] as const;
export type TakeoffCountMarkEventGesture = (typeof TAKEOFF_COUNT_MARK_EVENT_GESTURES)[number];

/** What supported a retained mark, as the journal kept it: one line per source proposal, its observation's words cut. */
const evidenceSchema = z.object({
  method: z.string().nullable(),
  methodVersion: z.string().nullable(),
  generation: count.nullable(),
  observation: z.object({ page: page.nullable(), quantity: z.number().nullable(), unit: z.string().nullable(),
    evidence: z.string().nullable() }).strict().nullable(),
}).strict();

const eventSchema = z.object({
  eventId: uuid,
  revision: count,
  ordinal: count,
  gesture: z.enum(TAKEOFF_COUNT_MARK_EVENT_GESTURES),
  markId: uuid.nullable(),
  page,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  evidence: z.array(evidenceSchema),
  actorKind: z.enum(["member", "worker"]),
  actorId: uuid.nullable(),
  occurredAt: timestamp,
}).strict();
export type CountMarkHistoryEvent = z.infer<typeof eventSchema>;

export const countMarksHistorySchema = z.object({
  answerId: uuid,
  events: z.array(eventSchema),
  next: z.object({ revision: count, ordinal: count }).strict().nullable()
    .describe("Position à donner pour la page suivante ; null à la fin du journal."),
  viewerId: uuid,
  names: z.record(uuid, z.string()),
}).strict();
export type CountMarksHistory = z.infer<typeof countMarksHistorySchema>;
