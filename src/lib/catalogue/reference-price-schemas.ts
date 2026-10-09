import { z } from "zod";

export const transportModeSchema = z.enum(["included", "excluded"]);
const quantitySchema = z.number().positive().max(999999999.999)
  .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001, "Trois décimales au maximum.");

export const referencePriceQuerySchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().pipe(quantitySchema).optional(),
  transport_mode: transportModeSchema.optional(),
});

export const referencePriceValidationSchema = z.object({
  action: z.literal("validate"),
  product_id: z.string().uuid(),
  quantity: quantitySchema,
  transport_mode: transportModeSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  manual_price_cents: z.number().int().min(0).max(2147483647).optional(),
  justification: z.string().trim().max(2000).optional(),
}).refine((value) => value.manual_price_cents === undefined || Boolean(value.justification), {
  path: ["justification"], message: "Justifiez le prix choisi manuellement.",
});

export const referenceOfferTransportSchema = z.object({
  action: z.literal("set-transport"),
  product_id: z.string().uuid(),
  offer_id: z.string().uuid(),
  transport_mode: transportModeSchema.nullable(),
  expected_updated_at: z.string().datetime({ offset: true }),
});

export const referencePriceActionSchema = z.union([
  referencePriceValidationSchema, referenceOfferTransportSchema,
]);

export const referenceOfferSchema = z.object({
  id: z.string().uuid(), supplier_id: z.string().uuid(), supplier_name: z.string(),
  supplier_sku: z.string().nullable(), unit_price_cents: z.number().int(),
  unit: z.string(), currency: z.string(), min_quantity: z.number(),
  valid_from: z.string(), valid_to: z.string().nullable(), updated_at: z.string(),
  transport_mode: transportModeSchema.nullable(),
  exclusion: z.enum([
    "inactive", "missing_supplier_reference", "future", "expired", "missing_quantity",
    "quantity", "unit", "currency", "missing_transport", "transport", "zero_price", "older_supplier_offer",
  ]).nullable(),
});

export const referencePriceProposalSchema = z.object({
  product_id: z.string().uuid(), designation: z.string(), quantity: z.number().nullable(),
  unit: z.string(), currency: z.literal("EUR"), transport_mode: transportModeSchema.nullable(),
  as_of: z.string(), current_price_cents: z.number().int().nullable(),
  validation_id: z.string().uuid().nullable(), product_updated_at: z.string(),
  offer_count: z.number().int(), proposed_price_cents: z.number().int().nullable(),
  minimum_cents: z.number().int().nullable(), maximum_cents: z.number().int().nullable(),
  dispersion_percent: z.number().nullable(), dispersion_alert: z.boolean(),
  zero_price_requires_review: z.boolean(),
  offers: z.array(referenceOfferSchema), fingerprint: z.string(),
});

export const referencePriceResponseSchema = z.object({
  proposal: referencePriceProposalSchema,
  can_validate: z.boolean(),
  latest_validation: z.object({
    id: z.string(), mode: z.enum(["average", "manual"]), validated_by: z.string(),
    validated_at: z.string(), unit_price_cents: z.number(), justification: z.string().nullable(),
  }).nullable(),
});

export type ReferencePriceResponse = z.infer<typeof referencePriceResponseSchema>;
export type ReferencePriceProposal = z.infer<typeof referencePriceProposalSchema>;
export type ReferencePriceAction = z.infer<typeof referencePriceActionSchema>;
export type ReferencePriceQuery = z.infer<typeof referencePriceQuerySchema>;
