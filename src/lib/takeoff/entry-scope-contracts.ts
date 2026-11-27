import { z } from "zod";
import { QUANTITY_ENTRY_CATEGORIES, type QuantityEntryCategory } from "./quantity-entry";

const base = { intent_key: z.string().uuid(), entry_revision: z.number().int().positive() };
const plan = { ...base, plan_id: z.string().uuid(), plan_entry_revision: z.number().int().nonnegative() };
export const entryScopeCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("withdraw") }).strict(),
  z.object({ ...plan, action: z.literal("attach") }).strict(),
  z.object({ ...plan, action: z.literal("replace"), plan_entry_revision: z.number().int().positive() }).strict(),
]);
export type EntryScopeCommand = z.infer<typeof entryScopeCommandSchema>;

export const collisionEntrySchema = z.object({
  quantity: z.number().positive(), unit: z.string(), category: z.enum(Object.keys(QUANTITY_ENTRY_CATEGORIES) as
    [QuantityEntryCategory, ...QuantityEntryCategory[]]), revision: z.number().int().positive(),
  actor_id: z.string().uuid(), entered_at: z.string().datetime({ offset: true }),
});
export const entryScopeResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("applied"), command_id: z.string().uuid(), replayed: z.boolean() }),
  z.object({ outcome: z.enum(["stale", "sent", "ineligible"]) }),
  z.object({ outcome: z.literal("collision"), entry: collisionEntrySchema.extend({ author: z.string() }) }),
]);
export type EntryScopeResult = z.infer<typeof entryScopeResultSchema>;
