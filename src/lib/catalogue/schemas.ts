import { z } from "zod";

import { isValidDateOnly } from "@/lib/date-only";
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

const optionalHttpUrlSchema = optionalTextSchema.superRefine((value, ctx) => {
  if (value === null) return;

  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return;
  } catch {
    // The issue below provides the stable API error.
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "L'URL doit utiliser HTTP ou HTTPS.",
  });
});
const positiveIntegerSchema = z.number().int().min(1, "Valeur numerique invalide.");
const positiveNumberSchema = z.number().gt(0, "Valeur numerique invalide.");
const nonNegativeIntegerSchema = z.number().int().min(0, "Valeur numerique invalide.");
const nonNegativeNumberSchema = z.number().min(0, "Valeur numerique invalide.");
const optionalUuidSchema = z.union([
  z.string().uuid(UUID_ERROR_MESSAGE),
  z.null(),
]).optional();
const optionalNonNegativeNumberSchema = z.union([
  nonNegativeNumberSchema,
  z.null(),
]).optional();
const optionalPositiveNumberSchema = z.union([positiveNumberSchema, z.null()]).optional();

const optionalDateSchema = z
  .union([z.string(), z.null()])
  .optional()
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

const pageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)]);
const sortDirectionSchema = z.enum(["asc", "desc"]);
const repeatedFilterSchema = z.array(z.string().trim().min(1).max(255)).max(100).default([]);

export const cataloguePageQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  material: repeatedFilterSchema,
  category: repeatedFilterSchema,
  unit: repeatedFilterSchema,
  price_status: z.array(z.enum(["fresh", "aging", "stale", "none"])).max(4).default([]),
  status: z.array(z.enum(["active", "archived"])).max(2).default([]),
  sort: z
    .enum([
      "designation",
      "material",
      "unit_price_cents",
      "best_supplier_price_cents",
      "updated_at",
    ])
    .default("designation"),
  dir: sortDirectionSchema.default("asc"),
  page: positiveIntegerSchema.max(100000).default(1),
  size: pageSizeSchema.default(25),
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
      message: "Le champ reference article est requis.",
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

export const pricesPageQuerySchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  freshness: z.array(z.enum(["fresh", "aging", "stale"])).max(3).default([]),
  supplier_id: z.string().uuid(UUID_ERROR_MESSAGE).nullable().default(null),
  product_id: z.string().uuid(UUID_ERROR_MESSAGE).nullable().default(null),
  sort: z.enum(["supplier", "product", "unit_price_cents", "updated_at"]).default("updated_at"),
  dir: sortDirectionSchema.default("desc"),
  page: positiveIntegerSchema.max(100000).default(1),
  size: pageSizeSchema.default(25),
});

export const priceLookupsQuerySchema = z.object({
  kind: z.enum(["supplier", "product", "all"]).default("all"),
  q: z.string().trim().max(200).optional().default(""),
  selected_id: z.string().uuid(UUID_ERROR_MESSAGE).nullable().default(null),
  limit: positiveIntegerSchema.max(50).default(50),
});

export const supplierCatalogItemLookupQuerySchema = z.object({
  supplier_id: z.string().uuid(UUID_ERROR_MESSAGE),
  product_id: z.string().uuid(UUID_ERROR_MESSAGE),
});

const newSupplierSchema = z.object({
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
});

const newProductSchema = z.object({
  reference: optionalTextSchema,
  designation: requiredTextSchema.max(500),
  category: optionalTextSchema,
  product_type: optionalTextSchema,
  material: optionalTextSchema,
  grade: optionalTextSchema,
  dimensions: optionalTextSchema,
  standard: optionalTextSchema,
  unit: optionalTextSchema,
  unit_price_cents: nonNegativeIntegerSchema.optional().default(0),
  tax_rate_bp: nonNegativeIntegerSchema.max(10000).optional().default(DEFAULT_TAX_RATE_BP),
});

const supplierPriceWriteFieldsSchema = z.object({
  supplier_id: optionalUuidSchema,
  new_supplier: newSupplierSchema.optional(),
  product_id: optionalUuidSchema,
  catalogue_item_id: optionalUuidSchema,
  new_product: newProductSchema.optional(),
  supplier_sku: optionalTextSchema,
  product_url: optionalHttpUrlSchema.optional(),
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
    new_product?: unknown;
  },
  ctx: z.RefinementCtx
) => {
  const hasExisting = Boolean(payload.product_id || payload.catalogue_item_id);
  const hasNew = payload.new_product !== undefined;
  if (hasExisting !== hasNew) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["product_id"],
    message: "Renseignez exactement un article existant ou un nouvel article.",
  });
};

const ensureSupplierIdentifier = (
  payload: { supplier_id?: string | null; new_supplier?: unknown },
  ctx: z.RefinementCtx
) => {
  const hasExisting = Boolean(payload.supplier_id);
  const hasNew = payload.new_supplier !== undefined;
  if (hasExisting !== hasNew) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["supplier_id"],
    message: "Renseignez exactement un fournisseur existant ou un nouveau fournisseur.",
  });
};

const supplierPriceCreateFieldsSchema = supplierPriceWriteFieldsSchema.extend({
  currency: z.string().trim().min(3).max(3).optional().default("EUR"),
});

const supplierPriceUpdateFieldsSchema = supplierPriceWriteFieldsSchema
  .omit({
    supplier_id: true,
    new_supplier: true,
    product_id: true,
    catalogue_item_id: true,
    new_product: true,
    supplier_sku: true,
    product_url: true,
  })
  .extend({
    unit: optionalTextUpdateSchema,
    valid_from: optionalDateUpdateSchema,
    valid_to: optionalDateUpdateSchema,
    source: optionalTextUpdateSchema,
    notes: optionalTextUpdateSchema,
  });

const createSupplierPriceBodySchema = supplierPriceCreateFieldsSchema.superRefine(
  (payload, ctx) => {
    ensureSupplierIdentifier(payload, ctx);
    ensureProductIdentifier(payload, ctx);
  }
);

const updateSupplierPriceBodySchema = supplierPriceUpdateFieldsSchema.partial().superRefine(
  (payload, ctx) => {
    if (Object.keys(payload).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "Aucun champ de mise a jour fourni.",
    });
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

export const updateSupplierCatalogItemSchema = z.object({
  action: z.literal("update-supplier-item"),
  id: z.string().uuid(UUID_ERROR_MESSAGE),
  supplier_sku: optionalTextSchema,
  product_url: optionalHttpUrlSchema,
});

const bulkCreatePriceItemSchema = supplierPriceCreateFieldsSchema
  .omit({ new_supplier: true, new_product: true })
  .extend({
    supplier_id: z.string().uuid(UUID_ERROR_MESSAGE),
    external_ref: optionalTextSchema,
  })
  .superRefine((payload, ctx) => {
    ensureProductIdentifier(payload, ctx);
  });

const MAX_BULK_CREATE_PRICES_BATCH_SIZE = 5000;
const MAX_BULK_CREATE_PRICES_ATOMIC_ITEMS = 50000;

export const bulkCreateSupplierPricesSchema = z.object({
  action: z.literal("bulk-create"),
  items: z.array(bulkCreatePriceItemSchema).min(1).max(MAX_BULK_CREATE_PRICES_BATCH_SIZE),
});

export const bulkCreateSupplierPricesAtomicSchema = z.object({
  action: z.literal("bulk-create-atomic"),
  items: z.array(bulkCreatePriceItemSchema).min(1).max(MAX_BULK_CREATE_PRICES_ATOMIC_ITEMS),
  batch_size: positiveIntegerSchema
    .max(MAX_BULK_CREATE_PRICES_BATCH_SIZE)
    .optional()
    .default(MAX_BULK_CREATE_PRICES_BATCH_SIZE),
});

export const pricesActionSchema = z.discriminatedUnion("action", [
  createSupplierPriceSchema,
  updateSupplierPriceSchema,
  deleteSupplierPriceSchema,
  updateSupplierCatalogItemSchema,
  bulkCreateSupplierPricesSchema,
  bulkCreateSupplierPricesAtomicSchema,
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

const normalizedStringArraySchema = z
  .array(z.string().trim().min(1))
  .max(200)
  .default([])
  .transform((values) => {
    const deduped = new Set<string>();
    for (const value of values) {
      const trimmed = value.trim();
      if (!trimmed) continue;
      deduped.add(trimmed);
    }
    return Array.from(deduped);
  });

export const resolvePriceImportSuggestionsSchema = z.object({
  unknownSuppliers: normalizedStringArraySchema,
  unknownProducts: normalizedStringArraySchema,
});

export const createMissingPriceImportEntitiesSchema = z.object({
  suppliersToCreate: normalizedStringArraySchema,
  productsToCreate: normalizedStringArraySchema,
});

export type CatalogueActionInput = z.infer<typeof catalogueActionSchema>;
export type PricesActionInput = z.infer<typeof pricesActionSchema>;
export type UpdateSupplierCatalogItemInput = z.infer<typeof updateSupplierCatalogItemSchema>;
export type IndicesActionInput = z.infer<typeof indicesActionSchema>;

export type LinkMappedRowsInput = z.infer<typeof linkMappedRowsSchema>;
export type CatalogueListQueryInput = z.infer<typeof catalogueListQuerySchema>;
export type CataloguePageQueryInput = z.infer<typeof cataloguePageQuerySchema>;
export type PricesListQueryInput = z.infer<typeof pricesListQuerySchema>;
export type PricesPageQueryInput = z.infer<typeof pricesPageQuerySchema>;
export type PriceLookupsQueryInput = z.infer<typeof priceLookupsQuerySchema>;
export type IndicesListQueryInput = z.infer<typeof indicesListQuerySchema>;

export type CreateCatalogueItemInput = z.infer<typeof createCatalogueItemSchema>["item"];
export type UpdateCatalogueItemInput = z.infer<typeof updateCatalogueItemSchema>;

export type SupplierCatalogItemLookupQueryInput = z.infer<
  typeof supplierCatalogItemLookupQuerySchema
>;
export type CreateSupplierPriceInput = z.infer<typeof createSupplierPriceSchema>["item"];
export type UpdateSupplierPriceInput = z.infer<typeof updateSupplierPriceSchema>;
export type BulkCreateSupplierPricesInput = z.infer<typeof bulkCreateSupplierPricesSchema>["items"];
export type BulkCreateSupplierPricesAtomicInput = z.infer<
  typeof bulkCreateSupplierPricesAtomicSchema
>;

export type CreateMaterialIndexInput = z.infer<typeof createMaterialIndexSchema>["item"];
export type UpdateMaterialIndexInput = z.infer<typeof updateMaterialIndexSchema>;
export type BulkUpsertMaterialIndicesInput = z.infer<typeof bulkUpsertMaterialIndicesSchema>["items"];

export type ResolvePriceImportSuggestionsInput = z.infer<
  typeof resolvePriceImportSuggestionsSchema
>;
export type CreateMissingPriceImportEntitiesInput = z.infer<
  typeof createMissingPriceImportEntitiesSchema
>;
