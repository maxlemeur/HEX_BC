import { z } from "zod";

import { TAKEOFF_LAUNCH_REQUEST_STATES } from "@/lib/takeoff/launch-request";
import { TAKEOFF_UNIT_STATES, type TakeoffRequestCoverage, type TakeoffRequestUnitView } from "@/lib/takeoff/launch-request-coverage";
import { TAKEOFF_LAUNCH_ACTIONS } from "@/lib/takeoff/operator-state";
import { takeoffActivityResumeSchema } from "@/lib/takeoff/resume-contracts";
import {
  takeoffResponseCountSchema as count,
  takeoffResponseTimestampSchema as timestamp,
  takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

/**
 * The affaire's launch requests as its activity shows them, from GET /api/takeoff/activity-center/requests: each request,
 * its units in the order its manifest recorded (each in exactly one state, as launch-request-coverage.ts counts them), and
 * what the member who reads may do with each analysis. One read whatever the number of plans or failures.
 */

const unitSchema = z.object({
  key: z.string().describe("plan:<source> ; unit:<rang> pour un plan dont la source n’est pas lisible par ce membre."),
  ordinal: z.number().int().positive().describe("Rang dans l’ordre enregistré : le Mac lit les unités dans cet ordre."),
  planFileId: uuid.nullable(),
  logicalId: z.string().nullable(),
  name: z.string(),
  pages: z.array(z.number().int().positive()).describe("Pages originales lues (à partir de 1) ; vide pour tout le plan."),
  jobId: uuid,
  state: z.enum(TAKEOFF_UNIT_STATES).describe(
    "queued (en attente de son tour ou d’une nouvelle tentative), running (en lecture), succeeded (lu, revue ouverte, envoyé ou "
    + "non), failed (lecture terminée sans résultat), canceled (arrêté par un membre), not_started (clos avant toute lecture).",
  ),
  reasonCode: z.string().nullable().describe("Code public d’un échec ou d’un arrêt ; l’écran affiche son motif en français."),
  retryAt: timestamp.nullable().describe("Échéance de la nouvelle tentative technique d’une unité en attente."),
  updatedAt: timestamp,
  reviewable: z.boolean().describe("Sa lecture peut être ouverte (« Revoir [plan] »), même pendant la lecture des autres plans."),
}) satisfies z.ZodType<TakeoffRequestUnitView>;

const coverageSchema = z.object({
  expected: count, queued: count, running: count, succeeded: count, failed: count, canceled: count, not_started: count,
}) satisfies z.ZodType<TakeoffRequestCoverage>;

/** A plan of the dossier: its source's identifier, or hidden:<list>:<rang> with « Plan N » where this member may not read it. */
const dossierPieceSchema = z.object({ id: z.union([uuid, z.string().regex(/^hidden:(added|replaced|removed):[1-9][0-9]*$/)]), name: z.string() });
const planSchema = z.object({ planFileId: uuid.nullable(), name: z.string(), pages: z.array(z.number().int().positive()) });

/** What this member may do with the analysis of a unit, by the one resume policy. Only the analyses the member reads. */
const jobSchema = z.object({
  jobId: uuid,
  planSetId: uuid.nullable(),
  estimateVersionId: uuid.nullable().describe("La version sur laquelle s’ouvre sa revue, une fois envoyée."),
  lastTransitionAt: timestamp.nullable().describe("Dernière transition de l’analyse (création, début, fin), jamais un renouvellement de bail."),
  itemCount: count.describe("Lignes retenues, c’est-à-dire non exclues."),
  applied: z.boolean().describe("Ses lignes sont envoyées au devis ; la lecture reste réussie."),
  errorCode: z.string().nullable().describe(
    "Code de diagnostic s’il a un motif public en français, sinon OTHER ; l’écran affiche le motif, jamais le code.",
  ),
  retryCount: count,
  resume: takeoffActivityResumeSchema.nullable().describe("Décision de reprise d’une analyse arrêtée, la même que son détail."),
  canCancel: z.boolean(),
  canResubmit: z.boolean().describe("Vrai si et seulement si resume.action vaut retry_now."),
  canSendItems: z.boolean().describe(
    "Ce membre peut envoyer au devis les postes retenus de ce plan : lu contre la liste des postes, terminé, pas encore envoyé, "
    + "et le membre écrit l’affaire (son propriétaire ingénieur ou un administrateur). Le serveur revérifie tout à l’aperçu.",
  ),
});

export const takeoffRequestActivitySchema = z.object({
  id: uuid,
  origin: z.enum(["automatic", "manual"]),
  intent: z.enum(["initial", "reread_plans", "remeasure_items"]),
  order: z.enum(["free", "item_list"]).describe(
    "Ce que la demande a posé : une lecture libre (envoi d’aujourd’hui), ou la liste des postes de l’affaire (envoi poste par poste).",
  ),
  state: z.enum(TAKEOFF_LAUNCH_REQUEST_STATES),
  outcome: z.enum(["success", "failure", "canceled", "partial"]).nullable(),
  reason: z.object({ code: z.string(), message: z.string() }).nullable()
    .describe("Pourquoi la demande n’a pas démarré ou s’est arrêtée, en français ; le code n’est jamais affiché."),
  createdAt: timestamp,
  admittedAt: timestamp.nullable(),
  closedAt: timestamp.nullable(),
  units: z.object({
    format: z.enum(["grouped", "per_plan"]),
    units: z.array(unitSchema),
    coverage: coverageSchema,
    unknownCalls: count.nullable().describe("Appels envoyés sans réponse (consommation indéterminée) ; null quand non évalué."),
  }).nullable().describe("Ses unités, une fois la demande admise sur un manifeste lisible."),
  groupedPlans: z.array(planSchema).describe("Les plans de l’analyse groupée d’un manifeste de format 1, avec leurs pages."),
  plansOmitted: z.array(z.object({ name: z.string(), reason: z.enum(["alternate", "identical_copy", "unsupported_format", "not_requested"]) })),
  jobs: z.array(jobSchema),
  action: z.object({ kind: z.enum(TAKEOFF_LAUNCH_ACTIONS), label: z.string().nullable(), mandateRevision: count }).nullable()
    .describe("Demande affichée non admise : le geste que la base permet à ce membre (prendre en charge, reprendre)."),
  dossierChanged: z.object({
    added: z.array(dossierPieceSchema),
    replaced: z.array(dossierPieceSchema),
    removed: z.array(dossierPieceSchema),
  }).nullable().describe("Plans ajoutés, remplacés ou retirés du dossier depuis le scellement, lu quand ses plans ne sont plus lus."),
});

export const TAKEOFF_REQUEST_ACTIVITY_VIEWS = ["current", "history", "request", "job"] as const;

export const takeoffRequestActivityResponseSchema = z.object({
  view: z.enum(TAKEOFF_REQUEST_ACTIVITY_VIEWS),
  observedAt: timestamp.describe("Heure du serveur à la lecture."),
  live: z.boolean().describe("Une demande lue, ou une analyse sans demande, peut encore changer d’elle-même."),
  signature: z.string().describe("Change à chaque transition lue, jamais sur un signal de vie : l’écran relit alors ses autres listes."),
  current: takeoffRequestActivitySchema.nullable()
    .describe("La dernière exécution de l’affaire (une demande mise de côté ne la cache pas), celle d’un lien ou celle d’une analyse."),
  history: z.array(takeoffRequestActivitySchema),
  historyHasOlder: z.boolean(),
  historyOffset: count,
  standalone: z.object({ running: count, waiting: count }).describe(
    "Analyses de l’affaire sans demande en cours de lecture ou mises en file à l’instant (running), en file depuis plus "
    + "longtemps ou en attente d’une reprise programmée (waiting).",
  ),
  elsewhere: z.object({ running: z.boolean(), waiting: z.boolean() }).describe(
    "Vues request et job : la dernière exécution de l’affaire, quand ce n’est pas celle affichée, lit un plan (running) ou "
    + "peut encore changer (waiting).",
  ),
  currentIsLatest: z.boolean().describe("La demande affichée est la dernière exécution de l’affaire."),
  inFlightJobIds: z.array(uuid).describe(
    "Analyses de l’affaire que cette lecture voit encore en file, en cours ou en attente de reprise : une analyse que la liste "
    + "montre ainsi et qui n’y figure pas a changé depuis la liste.",
  ),
  reused: z.object({
    dossierPosition: z.string().nullable().describe("Position du dossier de la demande affichée ; à renvoyer en dossierSeen."),
    dossier: z.boolean().describe("Le dossier n’a pas bougé depuis dossierSeen : son écart n’a pas été recalculé (dossierChanged nul)."),
    actionKey: z.string().nullable().describe("Clé du geste lu ; à renvoyer en actionSeen avec observedAt en actionSeenAt."),
    action: z.boolean().describe("Le geste n’a pas été relu (lu il y a moins de 30 s pour la même demande) : action nulle."),
  }),
});

export type TakeoffRequestActivity = z.infer<typeof takeoffRequestActivitySchema>;
export type TakeoffRequestActivityJob = TakeoffRequestActivity["jobs"][number];
export type TakeoffRequestActivityView = (typeof TAKEOFF_REQUEST_ACTIVITY_VIEWS)[number];
export type TakeoffRequestActivityResponse = z.infer<typeof takeoffRequestActivityResponseSchema>;
