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
});
export type TakeoffReviewContext = z.infer<typeof takeoffReviewContextResponseSchema>;
