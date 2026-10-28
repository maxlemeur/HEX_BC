import { z } from "zod";

export const copyUuidSchema = z.string().uuid();
export const copyTimestampSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)));
export const copyCountSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
export const copyVersionSchema = z.object({
  id: copyUuidSchema,
  updated_at: copyTimestampSchema,
  content_revision: copyCountSchema.optional(),
});
export const copyTotalsSchema = z.object({
  total_ht_cents: copyCountSchema,
  total_tax_cents: copyCountSchema,
  total_ttc_cents: copyCountSchema,
}).refine((totals) => totals.total_ht_cents + totals.total_tax_cents === totals.total_ttc_cents,
  "Les totaux de la copie sont incohérents.");
export const copyConvertedLineSchema = z.object({
  title: z.string(),
  template_hours: z.number().finite().nonnegative(),
  converted_hours: z.number().finite().nonnegative(),
});
export const copyConvertedLineClientSchema = z.object({
  title: copyConvertedLineSchema.shape.title,
  templateHours: copyConvertedLineSchema.shape.template_hours,
  convertedHours: copyConvertedLineSchema.shape.converted_hours,
});
export const copiedIdsSchema = z.array(copyUuidSchema).refine(
  (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "Les identifiants de la copie sont dupliqués."
);

export const sameCopyIdentity = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export function parseCopyResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("La réponse de copie ou d'import est invalide. Relisez le devis avant de poursuivre.");
  return result.data;
}

export function copyResponseRoot(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "data" in value) return value.data;
  return value;
}

/** Compatibility only renames fields; it never coerces, drops or repairs their values. */
export function copyResponseFields(value: unknown, aliases: Record<string, string>): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...value } as Record<string, unknown>;
  for (const [wire, alias] of Object.entries(aliases)) {
    if (!(wire in result) && alias in result) result[wire] = result[alias];
  }
  return result;
}

export function normalizeCopyResult(value: unknown): unknown {
  const root = copyResponseFields(copyResponseRoot(value), {
    version: "versionToken", converted_lines: "convertedLines",
  });
  if (!root || typeof root !== "object" || Array.isArray(root)) return root;
  const record = root as Record<string, unknown>;
  return {
    ...record,
    version: copyResponseFields(record.version ?? record.version_token, { updated_at: "updatedAt" }),
    totals: copyResponseFields(record.totals, {
      total_ht_cents: "totalHtCents", total_tax_cents: "totalTaxCents", total_ttc_cents: "totalTtcCents",
    }),
    ...(Array.isArray(record.converted_lines) ? { converted_lines: record.converted_lines.map((line) =>
      copyResponseFields(line, { template_hours: "templateHours", converted_hours: "convertedHours" })) } : {}),
  };
}
