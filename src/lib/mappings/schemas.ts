import { z } from "zod";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

const MAPPING_TARGET_FIELDS = [
  "hex_code",
  "designation",
  "quantity",
  "unit",
  "unit_price_ht",
  "total_ht",
  "category",
  "supply_type",
  "supplier_ref",
  "labor_hours",
  "h_mo_majoration",
  "notes",
] as const;

export type MappingTargetField = (typeof MAPPING_TARGET_FIELDS)[number];
export const REQUIRED_MAPPING_TARGET_FIELDS: MappingTargetField[] = [
  "hex_code",
  "designation",
];

export const mappingTargetFieldSchema = z.enum(MAPPING_TARGET_FIELDS);

const mappingValueSchema = z.union([z.string(), z.null(), z.undefined()]);

const mappingRecordRawSchema = z.record(z.string(), mappingValueSchema);

export type SourceToTargetMapping = Record<string, MappingTargetField>;

function normalizeMapping(
  input: Record<string, string | null | undefined>
): SourceToTargetMapping {
  const mapping: SourceToTargetMapping = {};

  for (const [rawSource, rawTarget] of Object.entries(input)) {
    const source = rawSource.trim();
    const target = typeof rawTarget === "string" ? rawTarget.trim() : "";

    if (!source || !target) continue;
    if (!MAPPING_TARGET_FIELDS.includes(target as MappingTargetField)) continue;

    mapping[source] = target as MappingTargetField;
  }

  return mapping;
}

export const mappingRecordSchema = mappingRecordRawSchema.transform(normalizeMapping);

const optionalTextSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  .optional();

export const previewMappingSchema = z.object({
  action: z.literal("preview"),
  import_id: z.string().uuid(UUID_ERROR_MESSAGE),
  mapping: mappingRecordSchema.optional().default({}),
  limit: z.number().int().min(1).max(200).optional().default(20),
});

export const suggestionsMappingSchema = z.object({
  action: z.literal("suggestions"),
  import_id: z.string().uuid(UUID_ERROR_MESSAGE),
});

export const validateMappingSchema = z.object({
  action: z.literal("validate"),
  mapping: mappingRecordSchema,
});

export const duplicatesMappingSchema = z.object({
  action: z.literal("duplicates"),
  import_id: z.string().uuid(UUID_ERROR_MESSAGE),
  mapping: mappingRecordSchema,
  limit: z.number().int().min(1).max(10000).optional().default(1000),
});

export const createMappingSchema = z.object({
  action: z.literal("create"),
  import_id: z.string().uuid(UUID_ERROR_MESSAGE),
  mapping: mappingRecordSchema,
  template_id: z.union([z.string().uuid(UUID_ERROR_MESSAGE), z.null()]).optional(),
  name: optionalTextSchema,
  notes: optionalTextSchema,
  save_template: z.boolean().optional().default(false),
  template_name: optionalTextSchema,
  supplier_name: optionalTextSchema,
});

export const saveTemplateSchema = z.object({
  action: z.literal("save-template"),
  name: z
    .string()
    .trim()
    .min(1, "Nom du template requis.")
    .max(120, "Nom du template trop long."),
  mapping: mappingRecordSchema,
  supplier_name: optionalTextSchema,
  is_default: z.boolean().optional().default(false),
});

export const mappingsActionSchema = z.discriminatedUnion("action", [
  previewMappingSchema,
  suggestionsMappingSchema,
  validateMappingSchema,
  duplicatesMappingSchema,
  createMappingSchema,
  saveTemplateSchema,
]);

export const listMappingsQuerySchema = z.object({
  import_id: z.union([z.string().uuid(UUID_ERROR_MESSAGE), z.null()]).optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
