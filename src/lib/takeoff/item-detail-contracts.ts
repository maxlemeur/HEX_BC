import { z } from "zod";

import {
  takeoffResponseCountSchema as count,
  takeoffResponseTimestampSchema as timestamp,
  takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

/**
 * The plan the detail of an item shows (lot 5): GET /api/affaires/{projectId}/takeoff/item-detail/plan. One resolution
 * per plan and reading, never per item or per mark: a reading's plan is the copy that analysis sealed (its digest, its
 * pages), even since replaced; a plan no analysis sealed is the dossier's current copy at the moment it is asked. The bytes
 * are fetched by the page reader from a short private address: the attested bytes' route, checked at each request, or the
 * plan centre's signed address, made for this member by this resolution. A resolution is asked again each time a plan is
 * opened, never kept.
 */

const page = z.number().int().positive();
const planKey = z.string().min(1).max(200);

export const ITEM_DETAIL_PLAN_UNAVAILABLE = [
  /** The bytes the reading sealed cannot be served any more (the copy left, or changed since). */
  "original_unavailable",
  /** The dossier holds no current copy of this plan now. */
  "no_current_copy",
  /** Several current copies: none is chosen for the member. */
  "several_copies",
  /** The generation the address names is not the dossier's any more. */
  "generation_replaced",
  /** A copy exists, but the route that serves its bytes does not serve them to this member. */
  "not_available_to_you",
] as const;
export type ItemDetailPlanUnavailable = (typeof ITEM_DETAIL_PLAN_UNAVAILABLE)[number];

export const itemDetailPlanViewSchema = z.object({
  plan: z.object({
    key: planKey.describe("Identité logique du plan : sa pièce du dossier, ou la copie déposée dans le jeu de plans."),
    name: z.string(),
    planFileId: uuid.nullable().describe("La copie montrée : celle que la lecture a scellée, ou la copie actuelle du dossier."),
    generation: z.string().nullable(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    pageCount: count.nullable(),
    pagesRead: z.array(page).describe("Pages originales lues par l’analyse (vide : tout le plan, ou aucune lecture)."),
  }).strict(),
  reading: z.object({
    jobId: uuid,
    status: z.string(),
    finishedAt: timestamp.nullable(),
  }).strict().nullable(),
  document: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("attested"), href: z.string().startsWith("/api/") })
      .strict().describe("Les octets que la lecture a attestés, vérifiés par le serveur à chaque demande."),
    z.object({ kind: z.literal("dossier"), planSetId: uuid, planFileId: uuid, url: z.string().url() })
      .strict().describe("La copie actuelle du dossier au moment de la demande, signée pour le membre par la lecture du centre de plans (durée courte)."),
    z.object({ kind: z.literal("unavailable"), reason: z.enum(ITEM_DETAIL_PLAN_UNAVAILABLE) }).strict(),
  ]),
}).strict();

export type ItemDetailPlanView = z.infer<typeof itemDetailPlanViewSchema>;

/** What the detail asks: a plan read by an analysis (plan + reading), the dossier's plan, or a dossier piece. */
export type ItemDetailPlanRequest = {
  planKey: string | null;
  jobId: string | null;
  source: { documentId: string; generation: string | null } | null;
};
