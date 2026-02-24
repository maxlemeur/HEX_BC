import { z } from "zod";

const requiredTextSchema = z
  .string()
  .trim()
  .min(1, "Champ obligatoire.");

const optionalNullableTextSchema = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  });

const positiveQuantitySchema = z
  .number()
  .finite("Nombre invalide.")
  .gt(0, "Doit etre > 0.");

const positiveIntegerSchema = z
  .number()
  .int("Entier attendu.")
  .min(1, "Doit etre >= 1.");

const nonNegativeIntegerSchema = z
  .number()
  .int("Entier attendu.")
  .min(0, "Doit etre >= 0.");

export const takeoffLevelSchema = z.enum(["A", "B", "C"]);

export const takeoffWarningSeveritySchema = z.enum(["info", "warning", "error"]);

const confidenceSchema = z
  .number()
  .finite("Nombre invalide.")
  .min(0, "Doit etre >= 0.")
  .max(1, "Doit etre <= 1.");

const warningCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z
    .string()
    .min(1, "Champ obligatoire.")
    .max(64, "Code trop long.")
);

const takeoffTableRowSchema = z
  .object({
    row_index: nonNegativeIntegerSchema,
    cells: z.array(requiredTextSchema).min(1, "Au moins une cellule est requise."),
  })
  .strict();

export const TakeoffWarningSchema = z
  .object({
    code: warningCodeSchema,
    message: requiredTextSchema.max(500, "Message trop long."),
    severity: takeoffWarningSeveritySchema,
    item_index: nonNegativeIntegerSchema.optional(),
    table_index: nonNegativeIntegerSchema.optional(),
  })
  .strict();

export const TakeoffTableSchema = z
  .object({
    page: positiveIntegerSchema,
    title: optionalNullableTextSchema.optional(),
    headers: z.array(requiredTextSchema).min(1, "Au moins un en-tete est requis."),
    rows: z.array(takeoffTableRowSchema).min(1, "Au moins une ligne est requise."),
  })
  .strict();

export const TakeoffItemSchema = z
  .object({
    designation: requiredTextSchema.max(500, "Designation trop longue."),
    quantity: positiveQuantitySchema,
    unit: requiredTextSchema.max(64, "Unite trop longue."),
    category: optionalNullableTextSchema.optional(),
    source_page: positiveIntegerSchema.optional(),
    source_file: requiredTextSchema.max(255, "Nom de fichier trop long.").optional(),
    confidence: confidenceSchema.optional(),
    evidence: requiredTextSchema.max(2000, "Evidence trop longue.").optional(),
  })
  .strict();

export const TakeoffMetadataSchema = z
  .object({
    level: takeoffLevelSchema,
    prompt_version: requiredTextSchema.max(64, "prompt_version trop long."),
    file_type: requiredTextSchema.max(64, "file_type trop long."),
    schema_version: requiredTextSchema.max(32, "schema_version trop long."),
  })
  .strict();

const takeoffExchangeBaseSchema = z
  .object({
    items: z.array(TakeoffItemSchema),
    warnings: z.array(TakeoffWarningSchema),
    tables: z.array(TakeoffTableSchema).optional(),
    metadata: TakeoffMetadataSchema,
    confidence: confidenceSchema.optional(),
  })
  .strict();

export const TakeoffExchangeSchema = takeoffExchangeBaseSchema.superRefine(
  (payload, ctx) => {
    if (payload.metadata.level === "B" && (!payload.tables || payload.tables.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tables est requis pour le niveau B.",
        path: ["tables"],
      });
    }

    if (payload.metadata.level === "C") {
      if (payload.confidence === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "confidence global est requis pour le niveau C.",
          path: ["confidence"],
        });
      }

      payload.items.forEach((item, index) => {
        if (!item.evidence || item.evidence.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "evidence est requis pour chaque item au niveau C.",
            path: ["items", index, "evidence"],
          });
        }
      });
    }
  }
);

function sanitizeGeminiJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGeminiJsonSchema(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "$schema") {
      continue;
    }

    result[key] = sanitizeGeminiJsonSchema(item);
  }

  return result;
}

export function zodToGeminiJsonSchema(
  schema: z.ZodType = TakeoffExchangeSchema
): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-07",
    io: "input",
    unrepresentable: "throw",
  });

  return sanitizeGeminiJsonSchema(jsonSchema) as Record<string, unknown>;
}
