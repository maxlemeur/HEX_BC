import { z } from "zod";

import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

const requiredTextSchema = z
  .string()
  .trim()
  .min(1, "Ce champ est requis.");

const optionalTextSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const optionalTextUpdateSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

const nonNegativeIntegerSchema = z
  .number()
  .int()
  .min(0, "Valeur numerique invalide.");

const productWriteFieldsSchema = z.object({
  reference: optionalTextSchema,
  designation: requiredTextSchema.max(500),
  category: optionalTextSchema,
  product_type: optionalTextSchema,
  material: optionalTextSchema,
  grade: optionalTextSchema,
  dimensions: optionalTextSchema,
  standard: optionalTextSchema,
  unit: z.string().trim().min(1).max(50).optional().default("u"),
  unit_price_cents: nonNegativeIntegerSchema.optional().default(0),
  tax_rate_bp: nonNegativeIntegerSchema
    .max(10000)
    .optional()
    .default(DEFAULT_TAX_RATE_BP),
  is_active: z.boolean().optional().default(true),
});

const productUpdateFieldsSchema = z
  .object({
    reference: optionalTextUpdateSchema,
    designation: requiredTextSchema.max(500).optional(),
    category: optionalTextUpdateSchema,
    product_type: optionalTextUpdateSchema,
    material: optionalTextUpdateSchema,
    grade: optionalTextUpdateSchema,
    dimensions: optionalTextUpdateSchema,
    standard: optionalTextUpdateSchema,
    unit: z.string().trim().min(1).max(50).optional(),
    unit_price_cents: nonNegativeIntegerSchema.optional(),
    tax_rate_bp: nonNegativeIntegerSchema.max(10000).optional(),
    is_active: z.boolean().optional(),
  })
  .partial()
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "Aucun champ de mise a jour fourni.",
    });
  });

export const createProductSchema = z.object({
  action: z.literal("create"),
  item: productWriteFieldsSchema,
});

export const updateProductSchema = z.object({
  action: z.literal("update"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
  item: productUpdateFieldsSchema,
});

export const productActionSchema = z.discriminatedUnion("action", [
  createProductSchema,
  updateProductSchema,
]);

const supplierWriteFieldsSchema = z.object({
  name: requiredTextSchema.max(255),
  address: optionalTextSchema,
  city: optionalTextSchema,
  postal_code: optionalTextSchema,
  country: optionalTextSchema,
  email: optionalTextSchema,
  phone: optionalTextSchema,
  contact_name: optionalTextSchema,
  siret: optionalTextSchema,
  vat_number: optionalTextSchema,
  payment_terms: optionalTextSchema,
  is_active: z.boolean().optional().default(true),
});

const supplierUpdateFieldsSchema = z
  .object({
    name: requiredTextSchema.max(255).optional(),
    address: optionalTextUpdateSchema,
    city: optionalTextUpdateSchema,
    postal_code: optionalTextUpdateSchema,
    country: optionalTextUpdateSchema,
    email: optionalTextUpdateSchema,
    phone: optionalTextUpdateSchema,
    contact_name: optionalTextUpdateSchema,
    siret: optionalTextUpdateSchema,
    vat_number: optionalTextUpdateSchema,
    payment_terms: optionalTextUpdateSchema,
    is_active: z.boolean().optional(),
  })
  .partial()
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "Aucun champ de mise a jour fourni.",
    });
  });

export const createSupplierSchema = z.object({
  action: z.literal("create"),
  item: supplierWriteFieldsSchema,
});

export const updateSupplierSchema = z.object({
  action: z.literal("update"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
  item: supplierUpdateFieldsSchema,
});

export const deleteSupplierSchema = z.object({
  action: z.literal("delete"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
});

export const supplierActionSchema = z.discriminatedUnion("action", [
  createSupplierSchema,
  updateSupplierSchema,
  deleteSupplierSchema,
]);

export const supplierListQuerySchema = z.object({
  view: z.enum(["list", "usage"]).optional().default("list"),
  id: z.string().uuid(UUID_ERROR_MESSAGE).optional(),
});

export type ProductActionInput = z.infer<typeof productActionSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>["item"];
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type SupplierActionInput = z.infer<typeof supplierActionSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>["item"];
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type SupplierListQueryInput = z.infer<typeof supplierListQuerySchema>;
