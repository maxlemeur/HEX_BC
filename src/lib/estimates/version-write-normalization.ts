import { badRequest } from "@/lib/http/api-response";
import { SUPPORTED_ESTIMATE_CURRENCIES } from "@/lib/money";

export const DEFAULT_CURRENCY = "EUR";

const INVALID_CURRENCY = `Devise invalide. Valeurs autorisees: ${SUPPORTED_ESTIMATE_CURRENCIES.join(", ")}.`;

export function normalizeEstimateCurrencyOrThrow(
  value: string | null | undefined,
  options?: {
    fallback?: string;
    fallbackOnInvalid?: boolean;
  }
) {
  const normalized = value?.trim().toUpperCase() ?? "";

  if (!normalized) {
    if (options?.fallback) return options.fallback;
    throw badRequest(INVALID_CURRENCY);
  }

  if (
    (SUPPORTED_ESTIMATE_CURRENCIES as readonly string[]).includes(normalized)
  ) {
    return normalized;
  }

  if (options?.fallback && options.fallbackOnInvalid === true) {
    return options.fallback;
  }

  throw badRequest(INVALID_CURRENCY);
}
