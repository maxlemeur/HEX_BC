import { z } from "zod";

const cents = z.number().int().nonnegative().refine(Number.isSafeInteger).nullable();
export const takeoffReviewContextResponseSchema = z.object({
  version_id: z.string().uuid(),
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
});
export type TakeoffReviewContext = z.infer<typeof takeoffReviewContextResponseSchema>;
