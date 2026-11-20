import { badRequest } from "@/lib/http/api-response";

export const DEFAULT_CURRENCY = "EUR";

const SUPPORTED_ESTIMATE_CURRENCIES = ["EUR", "USD", "GBP"] as const;

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
    throw badRequest("Devise invalide. Valeurs autorisees: EUR, USD, GBP.");
  }

  if (
    (SUPPORTED_ESTIMATE_CURRENCIES as readonly string[]).includes(normalized)
  ) {
    return normalized;
  }

  if (options?.fallback && options.fallbackOnInvalid === true) {
    return options.fallback;
  }

  throw badRequest("Devise invalide. Valeurs autorisees: EUR, USD, GBP.");
}
