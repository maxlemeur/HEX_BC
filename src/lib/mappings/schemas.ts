import { z } from "zod";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

// Value targets feed estimate lines. `h_mo_majoration` keeps the legacy meaning "unit not
// declared": the import refuses a non-empty value until the column declares % (100 = neutral),
// a coefficient or the OPTIMA additive convention (P-11, D11, sub-lot 2.3).
const VALUE_MAPPING_TARGET_FIELDS = [
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
  "labor_hours_per_unit",
  "h_mo_majoration",
  "h_mo_majoration_percent",
  "h_mo_majoration_coefficient",
  "h_mo_majoration_additive",
  "notes",
] as const;

// Role targets never become line values: `control_*` columns are recomputed amounts used to
// check the import, `param_*` columns are workbook parameters read from their parameter row,
// `unsupported_*` columns are recognised and reported as not supported (D11).
const CONTROL_MAPPING_TARGET_FIELDS = [
  "control_unit_price",
  "control_total_price",
  "control_supply_unit_price",
  "control_supply_total",
  "control_marked_up_hours_per_unit",
  "control_total_hours",
] as const;

const PARAMETER_MAPPING_TARGET_FIELDS = [
  "param_coeff_fo",
  "param_coeff_mo",
  "param_hourly_rate",
] as const;

const UNSUPPORTED_MAPPING_TARGET_FIELDS = [
  "unsupported_quantity_workshop",
  "unsupported_quantity_site",
  "unsupported_labor_price_workshop",
  "unsupported_labor_price_site",
  "unsupported_labor_total_workshop",
  "unsupported_labor_total_site",
] as const;

const MAPPING_TARGET_FIELDS = [
  ...VALUE_MAPPING_TARGET_FIELDS,
  ...CONTROL_MAPPING_TARGET_FIELDS,
  ...PARAMETER_MAPPING_TARGET_FIELDS,
  ...UNSUPPORTED_MAPPING_TARGET_FIELDS,
] as const;

export type MappingTargetField = (typeof MAPPING_TARGET_FIELDS)[number];
export type MappingTargetGroup = "value" | "control" | "param" | "unsupported";
export const REQUIRED_MAPPING_TARGET_FIELDS: MappingTargetField[] = [
  "designation",
];

export const mappingTargetFieldSchema = z.enum(MAPPING_TARGET_FIELDS);

export function getMappingTargetGroup(target: string): MappingTargetGroup | null {
  if ((VALUE_MAPPING_TARGET_FIELDS as readonly string[]).includes(target)) return "value";
  if ((CONTROL_MAPPING_TARGET_FIELDS as readonly string[]).includes(target)) return "control";
  if ((PARAMETER_MAPPING_TARGET_FIELDS as readonly string[]).includes(target)) return "param";
  if ((UNSUPPORTED_MAPPING_TARGET_FIELDS as readonly string[]).includes(target)) return "unsupported";
  return null;
}

export type MappingTargetFieldOption = {
  value: MappingTargetField;
  label: string;
  group: MappingTargetGroup;
  required?: boolean;
};

const MAPPING_TARGET_LABELS: Record<MappingTargetField, string> = {
  hex_code: "Référence article",
  designation: "Désignation",
  quantity: "Quantité",
  unit: "Unité",
  unit_price_ht: "Prix fourniture",
  total_ht: "Montant HT",
  category: "Catégorie",
  supply_type: "Type FO",
  supplier_ref: "Référence fournisseur",
  labor_hours: "Heures MO (totales de la ligne)",
  labor_hours_per_unit: "Heures MO par unité (h/u × Q)",
  h_mo_majoration: "Majoration MO (unité à choisir)",
  h_mo_majoration_percent: "Majoration MO (%), 100 = neutre",
  h_mo_majoration_coefficient: "Majoration MO (coefficient), 1 = neutre",
  h_mo_majoration_additive: "Majoration MO additive OPTIMA, 0 = neutre",
  notes: "Notes",
  control_unit_price: "Prix unitaire de vente",
  control_total_price: "Prix total de vente",
  control_supply_unit_price: "Prix unitaire fourniture vendu",
  control_supply_total: "Total fourniture",
  control_marked_up_hours_per_unit: "Temps unitaire majoré",
  control_total_hours: "Temps total",
  param_coeff_fo: "Coefficient FO du classeur",
  param_coeff_mo: "Coefficient MO du classeur",
  param_hourly_rate: "Taux horaire du classeur",
  unsupported_quantity_workshop: "Quantité atelier",
  unsupported_quantity_site: "Quantité chantier",
  unsupported_labor_price_workshop: "PU MO atelier",
  unsupported_labor_price_site: "PU MO chantier",
  unsupported_labor_total_workshop: "Total MO atelier",
  unsupported_labor_total_site: "Total MO chantier",
};

export const MAPPING_TARGET_GROUP_LABELS: Record<MappingTargetGroup, string> = {
  value: "Valeurs importées",
  control: "Colonnes de contrôle (jamais importées)",
  param: "Paramètres du classeur",
  unsupported: "Reconnues, non prises en charge",
};

export const MAPPING_TARGET_FIELD_OPTIONS: MappingTargetFieldOption[] = MAPPING_TARGET_FIELDS.map(
  (value) => ({
    value,
    label: MAPPING_TARGET_LABELS[value],
    group: getMappingTargetGroup(value) ?? "value",
    ...(REQUIRED_MAPPING_TARGET_FIELDS.includes(value) ? { required: true } : {}),
  })
);

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
  .union([z.string(), z.null()])
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

export const structurePreviewMappingSchema = z.object({
  action: z.literal("structure-preview"),
  import_id: z.string().uuid(UUID_ERROR_MESSAGE),
  mapping: mappingRecordSchema.optional().default({}),
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
  structurePreviewMappingSchema,
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
