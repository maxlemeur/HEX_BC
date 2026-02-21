import { z } from "zod";

import { isValidDateOnly } from "@/lib/date-only";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

const requiredTextSchema = z
  .string()
  .trim()
  .min(1, "Ce champ est requis.");

const optionalTextSchema = z
  .union([z.string(), z.null(), z.undefined()])
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

const positiveIntegerSchema = z.number().int().min(1, "Valeur numerique invalide.");
const positiveNumberSchema = z.number().gt(0, "Valeur numerique invalide.");
const nonNegativeIntegerSchema = z.number().int().min(0, "Valeur numerique invalide.");
const nonNegativeNumberSchema = z.number().min(0, "Valeur numerique invalide.");
const optionalUuidSchema = z.union([
  z.string().uuid(UUID_ERROR_MESSAGE),
  z.null(),
  z.undefined(),
]);
const optionalNonNegativeNumberSchema = z.union([
  nonNegativeNumberSchema,
  z.null(),
  z.undefined(),
]);
const optionalPositiveNumberSchema = z.union([positiveNumberSchema, z.null(), z.undefined()]);

const optionalDateSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (!isValidDateOnly(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date invalide (YYYY-MM-DD).",
      });
      return z.NEVER;
    }

    return trimmed;
  });

const optionalDateUpdateSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (!isValidDateOnly(trimmed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date invalide (YYYY-MM-DD).",
      });
      return z.NEVER;
    }

    return trimmed;
  });

export const catalogueListQuerySchema = z.object({
  search: z.union([z.string(), z.null()]).optional(),
  limit: positiveIntegerSchema.max(500).optional().default(100),
  include_inactive: z.boolean().optional().default(false),
});

const catalogueWriteFieldsSchema = z.object({
  reference: optionalTextSchema,
  hex_code: optionalTextSchema,
  designation: requiredTextSchema.max(500),
  unit_price_cents: nonNegativeIntegerSchema.optional(),
  tax_rate_bp: nonNegativeIntegerSchema.max(10000).optional(),
  unit: optionalTextSchema,
  category: optionalTextSchema,
  notes: optionalTextSchema,
  is_active: z.boolean().optional(),
});

const catalogueCreateFieldsSchema = catalogueWriteFieldsSchema.extend({
  is_active: z.boolean().optional().default(true),
});

const catalogueUpdateFieldsSchema = catalogueWriteFieldsSchema.extend({
  reference: optionalTextUpdateSchema,
  hex_code: optionalTextUpdateSchema,
  unit: optionalTextUpdateSchema,
  category: optionalTextUpdateSchema,
  notes: optionalTextUpdateSchema,
});

const createCatalogueItemBodySchema = catalogueCreateFieldsSchema.superRefine(
  (payload, ctx) => {
    if (payload.reference || payload.hex_code) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reference"],
      message: "Le champ reference (ou hex_code) est requis.",
    });
  }
);

const updateCatalogueItemBodySchema = catalogueUpdateFieldsSchema.partial().superRefine(
  (payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "Aucun champ de mise a jour fourni.",
    });
  }
);

export const createCatalogueItemSchema = z.object({
  action: z.literal("create"),
  item: createCatalogueItemBodySchema,
});

export const updateCatalogueItemSchema = z.object({
  action: z.literal("update"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
  item: updateCatalogueItemBodySchema,
});

export const deleteCatalogueItemSchema = z.object({
  action: z.literal("delete"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
});

export const linkMappedRowsSchema = z.object({
  action: z.literal("link-mapped-rows"),
  import_id: z.string().uuid(UUID_ERROR_MESSAGE),
  limit: positiveIntegerSchema.max(5000).optional().default(1000),
  create_missing: z.boolean().optional().default(true),
  update_payload: z.boolean().optional().default(true),
  dry_run: z.boolean().optional().default(false),
});

export const catalogueActionSchema = z.discriminatedUnion("action", [
  createCatalogueItemSchema,
  updateCatalogueItemSchema,
  deleteCatalogueItemSchema,
  linkMappedRowsSchema,
]);

export const pricesListQuerySchema = z.object({
  supplier_id: z.union([z.string().uuid(UUID_ERROR_MESSAGE), z.null()]).optional(),
  product_id: z.union([z.string().uuid(UUID_ERROR_MESSAGE), z.null()]).optional(),
  catalogue_item_id: z.union([z.string().uuid(UUID_ERROR_MESSAGE), z.null()]).optional(),
  limit: positiveIntegerSchema.max(1000).optional().default(200),
});

const supplierPriceWriteFieldsSchema = z.object({
  supplier_id: z.string().uuid(UUID_ERROR_MESSAGE),
  product_id: optionalUuidSchema,
  catalogue_item_id: optionalUuidSchema,
  supplier_sku: optionalTextSchema,
  unit: optionalTextSchema,
  min_quantity: optionalPositiveNumberSchema,
  unit_price_cents: nonNegativeIntegerSchema,
  currency: z.string().trim().min(3).max(3).optional(),
  valid_from: optionalDateSchema,
  valid_to: optionalDateSchema,
  is_active: z.boolean().optional(),
  source_import_id: optionalUuidSchema,
  source_mapped_row_id: optionalUuidSchema,
  source: optionalTextSchema,
  notes: optionalTextSchema,
});

const ensureProductIdentifier = (
  payload: {
    product_id?: string | null;
    catalogue_item_id?: string | null;
  },
  ctx: z.RefinementCtx
) => {
  if (payload.product_id || payload.catalogue_item_id) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["product_id"],
    message: "Le champ product_id (ou catalogue_item_id) est requis.",
  });
};

const supplierPriceCreateFieldsSchema = supplierPriceWriteFieldsSchema.extend({
  currency: z.string().trim().min(3).max(3).optional().default("EUR"),
});

const supplierPriceUpdateFieldsSchema = supplierPriceWriteFieldsSchema.extend({
  supplier_sku: optionalTextUpdateSchema,
  unit: optionalTextUpdateSchema,
  valid_from: optionalDateUpdateSchema,
  valid_to: optionalDateUpdateSchema,
  source: optionalTextUpdateSchema,
  notes: optionalTextUpdateSchema,
});

const createSupplierPriceBodySchema = supplierPriceCreateFieldsSchema.superRefine(
  (payload, ctx) => {
    ensureProductIdentifier(payload, ctx);
  }
);

const updateSupplierPriceBodySchema = supplierPriceUpdateFieldsSchema.partial().superRefine(
  (payload, ctx) => {
    if (Object.keys(payload).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Aucun champ de mise a jour fourni.",
      });
    }

    const hasProductIdentifier =
      Object.prototype.hasOwnProperty.call(payload, "product_id") ||
      Object.prototype.hasOwnProperty.call(payload, "catalogue_item_id");

    if (hasProductIdentifier) {
      ensureProductIdentifier(payload, ctx);
    }
  }
);

export const createSupplierPriceSchema = z.object({
  action: z.literal("create"),
  item: createSupplierPriceBodySchema,
});

export const updateSupplierPriceSchema = z.object({
  action: z.literal("update"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
  item: updateSupplierPriceBodySchema,
});

export const deleteSupplierPriceSchema = z.object({
  action: z.literal("delete"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
});

const bulkCreatePriceItemSchema = supplierPriceCreateFieldsSchema
  .extend({
    external_ref: optionalTextSchema,
  })
  .superRefine((payload, ctx) => {
    ensureProductIdentifier(payload, ctx);
  });

export const bulkCreateSupplierPricesSchema = z.object({
  action: z.literal("bulk-create"),
  items: z.array(bulkCreatePriceItemSchema).min(1).max(5000),
});

export const pricesActionSchema = z.discriminatedUnion("action", [
  createSupplierPriceSchema,
  updateSupplierPriceSchema,
  deleteSupplierPriceSchema,
  bulkCreateSupplierPricesSchema,
]);

export const indicesListQuerySchema = z.object({
  search: z.union([z.string(), z.null()]).optional(),
  limit: positiveIntegerSchema.max(1000).optional().default(200),
});

const materialIndexWriteFieldsSchema = z.object({
  index_code: optionalTextSchema,
  code: optionalTextSchema,
  label: requiredTextSchema.max(255),
  index_value: optionalNonNegativeNumberSchema,
  value: optionalNonNegativeNumberSchema,
  index_date: optionalDateSchema,
  effective_date: optionalDateSchema,
  unit: optionalTextSchema,
  source: optionalTextSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  notes: optionalTextSchema,
});

const ensureIndexIdentifier = (
  payload: {
    index_code?: string | null;
    code?: string | null;
  },
  ctx: z.RefinementCtx
) => {
  if (payload.index_code || payload.code) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["index_code"],
    message: "Le champ index_code (ou code) est requis.",
  });
};

const ensureIndexValue = (
  payload: {
    index_value?: number | null;
    value?: number | null;
  },
  ctx: z.RefinementCtx
) => {
  if (payload.index_value != null || payload.value != null) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["index_value"],
    message: "Le champ index_value (ou value) est requis.",
  });
};

const createMaterialIndexBodySchema = materialIndexWriteFieldsSchema.superRefine(
  (payload, ctx) => {
    ensureIndexIdentifier(payload, ctx);
    ensureIndexValue(payload, ctx);
  }
);

const materialIndexUpdateFieldsSchema = materialIndexWriteFieldsSchema.extend({
  index_code: optionalTextUpdateSchema,
  code: optionalTextUpdateSchema,
  index_date: optionalDateUpdateSchema,
  effective_date: optionalDateUpdateSchema,
  unit: optionalTextUpdateSchema,
  source: optionalTextUpdateSchema,
  notes: optionalTextUpdateSchema,
});

const updateMaterialIndexBodySchema = materialIndexUpdateFieldsSchema.partial().superRefine(
  (payload, ctx) => {
    if (Object.keys(payload).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Aucun champ de mise a jour fourni.",
      });
    }

    const hasIndexIdentifier =
      Object.prototype.hasOwnProperty.call(payload, "index_code") ||
      Object.prototype.hasOwnProperty.call(payload, "code");

    if (hasIndexIdentifier) {
      ensureIndexIdentifier(payload, ctx);
    }

    const hasIndexValue =
      Object.prototype.hasOwnProperty.call(payload, "index_value") ||
      Object.prototype.hasOwnProperty.call(payload, "value");

    if (hasIndexValue) {
      ensureIndexValue(payload, ctx);
    }
  }
);

export const createMaterialIndexSchema = z.object({
  action: z.literal("create"),
  item: createMaterialIndexBodySchema,
});

export const updateMaterialIndexSchema = z.object({
  action: z.literal("update"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
  item: updateMaterialIndexBodySchema,
});

export const deleteMaterialIndexSchema = z.object({
  action: z.literal("delete"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
});

const bulkUpsertIndexItemSchema = materialIndexWriteFieldsSchema
  .extend({
    external_ref: optionalTextSchema,
  })
  .superRefine((payload, ctx) => {
    ensureIndexIdentifier(payload, ctx);
    ensureIndexValue(payload, ctx);
  });

export const bulkUpsertMaterialIndicesSchema = z.object({
  action: z.literal("bulk-upsert"),
  items: z.array(bulkUpsertIndexItemSchema).min(1).max(5000),
});

export const indicesActionSchema = z.discriminatedUnion("action", [
  createMaterialIndexSchema,
  updateMaterialIndexSchema,
  deleteMaterialIndexSchema,
  bulkUpsertMaterialIndicesSchema,
]);

export type CatalogueActionInput = z.infer<typeof catalogueActionSchema>;
export type PricesActionInput = z.infer<typeof pricesActionSchema>;
export type IndicesActionInput = z.infer<typeof indicesActionSchema>;

export type LinkMappedRowsInput = z.infer<typeof linkMappedRowsSchema>;
export type CatalogueListQueryInput = z.infer<typeof catalogueListQuerySchema>;
export type PricesListQueryInput = z.infer<typeof pricesListQuerySchema>;
export type IndicesListQueryInput = z.infer<typeof indicesListQuerySchema>;

export type CreateCatalogueItemInput = z.infer<typeof createCatalogueItemSchema>["item"];
export type UpdateCatalogueItemInput = z.infer<typeof updateCatalogueItemSchema>;

export type CreateSupplierPriceInput = z.infer<typeof createSupplierPriceSchema>["item"];
export type UpdateSupplierPriceInput = z.infer<typeof updateSupplierPriceSchema>;
export type BulkCreateSupplierPricesInput = z.infer<typeof bulkCreateSupplierPricesSchema>["items"];

export type CreateMaterialIndexInput = z.infer<typeof createMaterialIndexSchema>["item"];
export type UpdateMaterialIndexInput = z.infer<typeof updateMaterialIndexSchema>;
export type BulkUpsertMaterialIndicesInput = z.infer<typeof bulkUpsertMaterialIndicesSchema>["items"];
