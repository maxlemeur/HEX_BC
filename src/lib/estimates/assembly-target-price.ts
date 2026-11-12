import { formatEUR } from "@/lib/money";

/**
 * TI-534: the indicative target price of a library ouvrage. The column is `not null default 0`, and an
 * ouvrage built by hand keeps that 0 (`pricing_source = 'manual'`), which is not a price. Only the review
 * of a generated ouvrage computes one, direct cost × margin, so its 0 is a real 0 € target price.
 */
const SOURCES_WITH_TARGET_PRICE: ReadonlySet<string> = new Set(["generated_ouvrage_review"]);

export const MISSING_ASSEMBLY_TARGET_PRICE_LABEL = "sans prix cible";

export function assemblyTargetPriceCents(row: {
  pricing_source?: unknown;
  indicative_target_price_cents?: unknown;
}): number | null {
  const cents = row.indicative_target_price_cents;
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0) return null;
  if (cents > 0) return cents;
  return typeof row.pricing_source === "string" && SOURCES_WITH_TARGET_PRICE.has(row.pricing_source)
    ? 0
    : null;
}

/** Never prints 0,00 € for a missing target price: the estimator would read it as the amount. */
export function formatAssemblyTargetPrice(cents: number | null | undefined): string {
  return typeof cents === "number" ? formatEUR(cents) : MISSING_ASSEMBLY_TARGET_PRICE_LABEL;
}
