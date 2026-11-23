import { z } from "zod";

import { ITEM_SEND_BREAKDOWNS } from "@/lib/takeoff/item-send-plan";

const id = z.string().uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const selection = z.object({ version_id: id, item_id: id, breakdown: z.enum(ITEM_SEND_BREAKDOWNS) }).strict();

export const redistributionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }).strict(),
  selection.extend({ action: z.literal("preview") }),
  selection.extend({ action: z.literal("confirm"), request_id: id, digest }),
]);

export const redistributionOptionSchema = z.object({
  version_id: id, version_number: z.number().int(), item_id: id, title: z.string(),
});

export const redistributionPreviewSchema = z.object({
  digest, currency: z.string(), sources: z.array(z.object({
    target_id: id, line_id: id.nullable(), title: z.string(), quantity: z.number().nullable(), unit: z.string(),
    key: z.string(), label: z.string().nullable(), price_cents: z.number().nullable(), tax_rate_bp: z.number().nullable(),
    hours_per_unit: z.number().nullable(), k_fo: z.number().nullable(), k_mo: z.number().nullable(),
  })),
  parts: z.array(z.object({ id, from_target: id, plan_name: z.string().nullable(), label: z.string().nullable(), available: z.boolean(), building_state: z.string().nullable(), level_state: z.string().nullable(), quantity: z.number(), unit: z.string(), pages: z.array(z.number().int()) })),
  destinations: z.array(z.object({ key: z.string(), label: z.string(), quantity: z.number(), raw: z.number(), line_id: id.nullable() })),
  blockers: z.array(z.object({ reason: z.enum(["location_unavailable", "unchanged", "mixed", "dpgf", "deleted", "quantity", "edited", "used", "identity", "section", "quantity_limit", "depth"]), title: z.string() })),
  remove_lines: z.array(id),
});

export const redistributionResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), options: z.array(redistributionOptionSchema) }),
  z.object({ action: z.literal("preview"), preview: redistributionPreviewSchema }),
  z.object({ action: z.literal("confirm"), receipt_id: id, replayed: z.boolean() }),
]);

export type RedistributionRequest = z.infer<typeof redistributionRequestSchema>;
export type RedistributionResponse = z.infer<typeof redistributionResponseSchema>;
export type RedistributionPreview = z.infer<typeof redistributionPreviewSchema>;
export type RedistributionOption = z.infer<typeof redistributionOptionSchema>;
