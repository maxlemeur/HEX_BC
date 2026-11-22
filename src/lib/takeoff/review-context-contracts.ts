import { z } from "zod";

const cents = z.number().int().nonnegative().refine(Number.isSafeInteger).nullable();
export const takeoffReviewContextResponseSchema = z.object({
  version_id: z.string().uuid().nullable(),
  unlinked_item_ids: z.array(z.string().uuid()),
  posts: z.array(z.object({
    line_id: z.string().uuid(), title: z.string(), lot_id: z.string().uuid().nullable(),
    amount_cents: cents, lot_amount_cents: cents, impact_cents: cents,
    recommend_review: z.boolean().nullable(), item_ids: z.array(z.string().uuid()),
  })),
  // TI-701 (D13): each included takeoff line an estimate line holds, at that line's unit price (null when it is not
  // « Chiffrée »), with its lot: « Gros montants » prices the line at its own quantity, « Non chiffré » reads the rest.
  item_pricing: z.array(z.object({
    item_id: z.string().uuid(), line_id: z.string().uuid(), pricing_status: z.string().nullable(),
    unit_price_cents: z.number().int().refine(Number.isSafeInteger).nullable(),
    lot: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
  })),
  /**
   * Lot 3: for an analysis of one plan that was sent, what its send compared that changed since (a peer's lines, a
   * peer read again or removed, a plan read during the send, a location or a copy of a plan revision), with the lines it
   * sent; null otherwise. Absent from a server before it (optional).
   */
  send_context: z.object({
    changed: z.boolean(),
    sent_at: z.string(),
    changes: z.array(z.object({ reason: z.enum(["peer_changed", "peer_read_again", "peer_removed", "peer_appeared",
      "location_changed", "copy_changed"]), plan_name: z.string().nullable() })),
    item_ids: z.array(z.string().uuid()),
  }).nullable().optional(),
}).refine((context) => context.version_id !== null
  || (context.posts.length === 0 && context.item_pricing.length === 0 && context.unlinked_item_ids.length === 0),
  "Les comparaisons chiffrées nécessitent un devis.");
export type TakeoffReviewContext = z.infer<typeof takeoffReviewContextResponseSchema>;
