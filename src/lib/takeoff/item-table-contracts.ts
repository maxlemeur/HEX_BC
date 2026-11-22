import { z } from "zod";

import { chatGptReasoningEffortSchema } from "@/lib/ai/chatgpt-model-preferences";
import { ITEM_AGGREGATE_STATES, ITEM_ANSWER_OUTCOMES } from "@/lib/takeoff/item-answer-aggregation";
import {
  ITEM_ANSWER_ANOMALIES,
  ITEM_INELIGIBILITIES,
  ITEM_LINE_DECISIONS,
  ITEM_REVIEW_GESTURES,
  ITEM_REVIEW_LIMITS,
  ITEM_SET_ASIDE_REASONS,
  type ItemTableLine,
} from "@/lib/takeoff/item-table";
import { TAKEOFF_UNIT_STATES } from "@/lib/takeoff/launch-request-coverage";
import { QUANTITY_ENTRY_CATEGORIES, quantityEntrySchema, type QuantityEntryCategory } from "@/lib/takeoff/quantity-entry";
import {
  takeoffResponseConfidenceSchema as confidence,
  takeoffResponseCountSchema as count,
  takeoffResponseTimestampSchema as timestamp,
  takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

/**
 * The contracts of the table of items of an affaire's takeoff (lot 4): its read (GET /api/affaires/{projectId}/takeoff/
 * items), the frozen selection of a filter or of the items a member ticked, the review commands and the remeasure of a
 * selection. Every command is versioned, names its targets explicitly (each answer with its revision and its
 * decision's revision) in one scope, and carries an intention key: the same key replays the same answer.
 */

export const ITEM_TABLE_PAGE_SIZES = [25, 50, 100] as const;
export const ITEM_REVIEW_COMMAND_VERSION = 1 as const;

const quantity = z.number().finite();
const positiveQuantity = z.number().finite().positive();
const unit = z.string().trim().min(1).max(16);
const page = z.number().int().positive();
const planKey = z.string().min(1).max(200)
  .describe("Identité logique du plan (pièce du dossier, ou copie déposée dans le jeu de plans) : stable d’une copie à l’autre.");

export const itemTableScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("affaire") }).strict(),
  z.object({ kind: z.literal("plan"), planKey }).strict(),
]).describe("affaire : tous les plans où le poste a été demandé ; plan : la réponse du poste sur ce plan.");

export const itemTableFilterSchema = z.object({
  states: z.array(z.enum(ITEM_AGGREGATE_STATES)).max(ITEM_AGGREGATE_STATES.length).optional(),
  families: z.array(z.string().min(1).max(4000)).max(200).optional(),
  locations: z.array(z.string().min(1).max(200)).max(200).optional(),
  decisions: z.array(z.enum(ITEM_LINE_DECISIONS)).max(ITEM_LINE_DECISIONS.length).optional(),
}).strict();

const observationSchema = z.object({
  observationId: z.string().min(1),
  role: z.enum(["contribution", "candidate", "alternative"])
    .describe("contribution : comptée dans le total de la réponse ; candidate : un indice ; alternative : une autre lecture, jamais ajoutée."),
  quantity: positiveQuantity,
  unit,
  page: page.nullable(),
  evidence: z.string().nullable(),
  confidence: confidence.nullable(),
  method: z.string().nullable(),
  takeoffItemId: uuid.nullable().describe("La ligne de l’analyse qu’une contribution est : ce que la revue ciblée corrige."),
}).strict();

const answerSchema = z.object({
  answerId: uuid,
  revision: z.string().min(1).max(128).describe("Empreinte de la réponse lue ; une commande nomme la réponse par son identifiant."),
  jobId: z.string().min(1),
  outcome: z.enum(ITEM_ANSWER_OUTCOMES),
  quantity: z.object({ quantity: positiveQuantity, unit }).strict().nullable()
    .describe("Le total d’une réponse mesurée : la somme de ses contributions."),
  reasonCode: z.string().max(64).nullable(),
  reasonText: z.string().max(2000).nullable().describe("Ce que la lecture du plan dit du poste, jamais un message de la base."),
  searchedPages: z.array(page),
  unreadablePages: z.array(page),
  observations: z.array(observationSchema),
  candidate: z.object({ quantity: positiveQuantity, unit }).strict().nullable()
    .describe("Valeur candidate d’une réponse incertaine : jamais une quantité mesurée."),
  anomalies: z.array(z.enum(ITEM_ANSWER_ANOMALIES)),
  readAt: timestamp,
}).strict();

const decisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accepted"), revision: count, actorId: uuid, at: timestamp }).strict(),
  z.object({ kind: z.literal("set_aside"), revision: count, reason: z.enum(ITEM_SET_ASIDE_REASONS), note: z.string().nullable(),
    actorId: uuid, at: timestamp }).strict(),
]);

const categories = Object.keys(QUANTITY_ENTRY_CATEGORIES) as [QuantityEntryCategory, ...QuantityEntryCategory[]];
const entrySchema = z.object({
  itemId: uuid,
  scope: z.enum(["affaire", "plan"]),
  planKey: planKey.nullable(),
  revision: count,
  quantity: positiveQuantity,
  unit,
  category: z.enum(categories),
  note: z.string().nullable(),
  included: z.boolean().describe("Une hypothèse ne compte qu’une fois incluse par sa propre décision."),
  actorId: uuid,
  at: timestamp,
  previous: z.object({ quantity: positiveQuantity, unit }).strict().nullable(),
}).strict();

const eligibilitySchema = z.object({ eligible: z.boolean(), reason: z.enum(ITEM_INELIGIBILITIES).nullable() }).strict();

export const itemReviewTargetSchema = z.object({
  itemId: uuid,
  entryRevision: count.describe("Révision de la saisie de la portée (0 sans saisie)."),
  answers: z.array(z.object({ answerId: uuid, answerRevision: z.string().min(1).max(128), decisionRevision: count }).strict())
    .max(ITEM_REVIEW_LIMITS.answers),
}).strict();

const lineSchema = z.object({
  itemId: uuid,
  position: count,
  label: z.string(),
  expectedUnit: z.string().nullable(),
  sectionPath: z.array(z.string()),
  family: z.string().nullable(),
  origin: z.enum(["dpgf", "template", "manual"]),
  reference: z.object({ quantity, dpgfReference: z.string().nullable() }).strict().nullable(),
  state: z.enum(ITEM_AGGREGATE_STATES).describe(
    "to_measure (aucun plan interrogé), reading (un plan en file ou en lecture), incomplete (un plan terminé sans réponse), "
    + "failed (aucun plan n’a répondu), measured, uncertain, not_found (verdict d’une couverture complète).",
  ),
  coverage: z.object({ expected: count, answered: count, inFlight: count, ended: count }).strict(),
  observed: z.object({ quantity, unit, partial: z.boolean() }).strict().nullable(),
  retained: z.object({ quantity, unit, source: z.enum(["measured", "entered", "mixed"]), partial: z.boolean() }).strict().nullable(),
  entry: entrySchema.nullable(),
  gap: z.object({ quantity, percent: quantity.nullable(), requiresReview: z.boolean() }).strict().nullable(),
  reasons: z.array(z.string()),
  planCount: count,
  decision: z.enum(ITEM_LINE_DECISIONS),
  readings: z.array(z.object({
    planKey,
    planName: z.string(),
    location: z.string().nullable(),
    unit: z.enum(TAKEOFF_UNIT_STATES),
    answer: answerSchema.nullable(),
    decision: decisionSchema.nullable(),
    entry: entrySchema.nullable(),
  }).strict()),
  targets: itemReviewTargetSchema,
  remeasurePlans: z.array(planKey),
  eligibility: z.object(Object.fromEntries(ITEM_REVIEW_GESTURES.map((gesture) => [gesture, eligibilitySchema])) as
    Record<(typeof ITEM_REVIEW_GESTURES)[number], typeof eligibilitySchema>).strict(),
}).strict() satisfies z.ZodType<ItemTableLine>;

export const itemTableResponseSchema = z.object({
  projectId: uuid,
  canReview: z.boolean().describe("Le membre peut revoir les postes (opérateur du métré de l’affaire)."),
  list: z.object({ revisionId: uuid, revision: count, itemCount: count }).strict().nullable()
    .describe("La révision enregistrée de la liste des postes ; nulle tant qu’aucune n’est enregistrée."),
  scope: itemTableScopeSchema,
  filter: itemTableFilterSchema,
  plans: z.array(z.object({ key: planKey, name: z.string(), location: z.object({ key: z.string(), label: z.string() }).strict().nullable() }).strict()),
  facets: z.object({
    states: z.record(z.enum(ITEM_AGGREGATE_STATES), count),
    decisions: z.record(z.enum(ITEM_LINE_DECISIONS), count),
    families: z.array(z.object({ value: z.string(), count }).strict()),
    locations: z.array(z.object({ value: z.string(), label: z.string(), count }).strict()),
    plans: z.array(z.object({ key: planKey, name: z.string(), count }).strict()),
  }).strict(),
  page: z.object({ lines: z.array(lineSchema), total: count, offset: count, limit: count, focusFound: z.boolean() }).strict(),
  names: z.record(z.string(), z.string()).describe("Noms des membres auteurs des décisions et des saisies affichées."),
  observedAt: timestamp,
}).strict();

export type ItemTableResponse = z.infer<typeof itemTableResponseSchema>;

/** One item of the list on its own, outside any filter (a link of the radar, the detail): null when the list does not hold it. */
export const itemTableLineResponseSchema = z.object({
  projectId: uuid,
  canReview: z.boolean(),
  line: lineSchema,
  plans: z.array(z.object({ key: planKey, name: z.string(), location: z.object({ key: z.string(), label: z.string() }).strict().nullable() }).strict()),
  names: z.record(z.string(), z.string()),
}).strict();

export type ItemTableLineResponse = z.infer<typeof itemTableLineResponseSchema>;
export type ItemTableResponseLine = ItemTableResponse["page"]["lines"][number];

export const itemSelectionRequestSchema = z.object({
  command_version: z.literal(ITEM_REVIEW_COMMAND_VERSION),
  scope: itemTableScopeSchema,
  selection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("filter"), filter: itemTableFilterSchema }).strict(),
    z.object({ kind: z.literal("items"), item_ids: z.array(uuid).min(1).max(ITEM_REVIEW_LIMITS.items) }).strict(),
  ]),
}).strict();

export const itemSelectionResponseSchema = z.object({
  count,
  items: z.array(z.object({
    itemId: uuid,
    label: z.string(),
    target: itemReviewTargetSchema,
    eligible: z.array(z.enum(ITEM_REVIEW_GESTURES)).describe("Gestes qui s’appliquent à ce poste, décidés de nouveau à la commande."),
  }).strict()),
  eligible: z.object(Object.fromEntries(ITEM_REVIEW_GESTURES.map((gesture) => [gesture, count])) as
    Record<(typeof ITEM_REVIEW_GESTURES)[number], typeof count>).strict(),
  missing: z.array(uuid).describe("Postes demandés qui ne sont plus dans la portée."),
}).strict();

export type ItemSelectionResponse = z.infer<typeof itemSelectionResponseSchema>;

const commandBase = {
  command_version: z.literal(ITEM_REVIEW_COMMAND_VERSION),
  intent_key: uuid.describe("Clé d’intention : la même clé rend la même réponse, une autre commande sous la même clé est un conflit."),
  scope: itemTableScopeSchema,
  targets: z.array(itemReviewTargetSchema).min(1).max(ITEM_REVIEW_LIMITS.items),
};

/** The note of « Autre », in code points without the blanks at its ends. */
export const ITEM_SET_ASIDE_NOTE = { min: 3, max: 500 } as const;

export const itemReviewCommandSchema = z.discriminatedUnion("gesture", [
  z.object({ ...commandBase, gesture: z.literal("accept_measured") }).strict(),
  z.object({ ...commandBase, gesture: z.literal("set_aside"), reason: z.enum(ITEM_SET_ASIDE_REASONS),
    note: z.string().max(2000).optional() }).strict(),
  z.object({ ...commandBase, gesture: z.literal("reinstate") }).strict(),
  z.object({ ...commandBase, gesture: z.literal("enter_quantity"),
    values: z.array(z.object({ item_id: uuid, quantity: positiveQuantity, unit }).strict()).min(1).max(ITEM_REVIEW_LIMITS.items)
      .describe("Une valeur et une unité par poste, saisies séparément : jamais un nombre recopié sur tous."),
    entry: quantityEntrySchema.describe("Catégorie choisie une fois pour la sélection, et sa note.") }).strict(),
  z.object({ ...commandBase, gesture: z.literal("include_entry"), targets: z.array(itemReviewTargetSchema).length(1) }).strict(),
]);

export type ItemReviewCommand = z.infer<typeof itemReviewCommandSchema>;

export const itemReviewResultSchema = z.object({
  outcome: z.enum(["applied", "replayed"]),
  applied: z.array(z.object({ itemId: uuid, label: z.string(), answers: count }).strict()),
  skipped: z.array(z.object({ itemId: uuid, label: z.string(), reason: z.enum(ITEM_INELIGIBILITIES) }).strict()),
}).strict();

export type ItemReviewResult = z.infer<typeof itemReviewResultSchema>;

/** A refusal that names the lines of the selection that changed since it was frozen: nothing was applied. */
export const itemReviewStaleDetailsSchema = z.object({
  stale: z.array(z.object({ itemId: uuid, label: z.string().nullable() }).strict()),
}).strict();

export const itemRemeasurePreviewRequestSchema = z.object({
  command_version: z.literal(ITEM_REVIEW_COMMAND_VERSION),
  scope: itemTableScopeSchema,
  item_ids: z.array(uuid).min(1).max(ITEM_REVIEW_LIMITS.items),
}).strict();

export const itemRemeasurePreviewSchema = z.object({
  items: z.array(z.object({ itemId: uuid, label: z.string() }).strict()),
  plans: z.array(z.object({ key: planKey, name: z.string() }).strict()),
  payer: z.object({ memberId: uuid, name: z.string().nullable() }).strict()
    .describe("Le membre qui confirme : la demande utilise son propre forfait ChatGPT, jamais celui du signataire du dossier."),
  subscription: z.discriminatedUnion("state", [
    z.object({ state: z.literal("ready"), model: z.string(), reasoningEffort: chatGptReasoningEffortSchema.nullable() }).strict(),
    z.object({ state: z.literal("unavailable"), reason: z.string() }).strict(),
  ]),
  running: z.boolean().describe("Une demande de l’affaire est en cours : la confirmation garde la sélection prête."),
  previewDigest: z.string().regex(/^[0-9a-f]{64}$/),
  skipped: z.array(z.object({ itemId: uuid, label: z.string(), reason: z.enum(ITEM_INELIGIBILITIES) }).strict())
    .describe("Postes de la sélection que la demande ne remesurera pas (en lecture, sans plan), avec leur motif."),
}).strict();

export type ItemRemeasurePreview = z.infer<typeof itemRemeasurePreviewSchema>;

export const itemRemeasureCommandSchema = z.object({
  command_version: z.literal(ITEM_REVIEW_COMMAND_VERSION),
  intent_key: uuid,
  scope: itemTableScopeSchema,
  item_ids: z.array(uuid).min(1).max(ITEM_REVIEW_LIMITS.items),
  plan_keys: z.array(planKey).min(1).max(200),
  setting: z.object({ reasoning_effort: chatGptReasoningEffortSchema.nullable() }).strict().nullable()
    .describe("Réglage ponctuel de cette demande ; nul : celui de Mon profil. Jamais enregistré dans le profil."),
  preview_digest: z.string().regex(/^[0-9a-f]{64}$/).describe("Empreinte de l’aperçu confirmé : payeur, plans, postes et réglage."),
}).strict();

export type ItemRemeasureCommand = z.infer<typeof itemRemeasureCommandSchema>;

export const itemRemeasureResultSchema = z.object({
  outcome: z.enum(["admitted", "replayed", "already_running"]),
  requestId: uuid.nullable(),
}).strict();

export type ItemRemeasureResult = z.infer<typeof itemRemeasureResultSchema>;
