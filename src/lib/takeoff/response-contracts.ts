import { z } from "zod";

export const takeoffResponseUuidSchema = z.string().uuid();
export const takeoffResponseTimestampSchema = z.string().refine((value) => Number.isFinite(Date.parse(value)));
export const takeoffResponseCountSchema = z.number().int().nonnegative().refine(Number.isSafeInteger);
export const takeoffResponseConfidenceSchema = z.number().finite().min(0).max(1);
export const takeoffResponseMetadataSchema = z.record(z.string(), z.unknown());
export const sameTakeoffResponseId = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
export const uniqueTakeoffResponseIds = (ids: string[]) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length;

/** Output failures must not surface as Zod request errors (HTTP 400). */
export function parseTakeoffResponse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw new Error("La réponse du métré est invalide. Relisez les données avant toute nouvelle action.");
  return result.data;
}

export function assertTakeoffResponseIdentity(condition: boolean): asserts condition {
  if (!condition) throw new Error("La réponse du métré ne correspond pas à l'action demandée. Relisez les données.");
}
