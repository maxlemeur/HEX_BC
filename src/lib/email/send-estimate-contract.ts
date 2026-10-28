import { z } from "zod";

export const ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE =
  "La confirmation de l’envoi n’a pas pu être vérifiée. Réessayez avec les mêmes informations pour vérifier cet envoi.";

export const estimateEmailReceiptSchema = z.object({
  version_id: z.string().uuid(),
  request_id: z.string().uuid(),
  // Historical completed dispatches may not have retained the provider ID.
  message_id: z.string().trim().min(1).nullable(),
});

export type EstimateEmailReceipt = z.infer<typeof estimateEmailReceiptSchema>;
export type EstimateEmailRequestIdentity = { versionId: string; requestId: string };

export const estimateEmailSendResponseSchema = z.object({
  ok: z.literal(true),
  data: estimateEmailReceiptSchema,
  error: z.never().optional(),
});

export function parseEstimateEmailReceipt(
  value: unknown,
  expected: EstimateEmailRequestIdentity
): EstimateEmailReceipt {
  const parsed = estimateEmailReceiptSchema.safeParse(value);
  if (!parsed.success ||
      parsed.data.version_id.toLowerCase() !== expected.versionId.toLowerCase() ||
      parsed.data.request_id.toLowerCase() !== expected.requestId.toLowerCase()) {
    throw new Error(ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE);
  }
  return parsed.data;
}

export function parseEstimateEmailSendResponse(
  value: unknown,
  expected: EstimateEmailRequestIdentity
): EstimateEmailReceipt {
  const parsed = estimateEmailSendResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error(ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE);
  return parseEstimateEmailReceipt(parsed.data.data, expected);
}
