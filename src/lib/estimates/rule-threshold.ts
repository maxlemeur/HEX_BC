export const DEFAULT_APPROVAL_THRESHOLD_EUROS = 5_000;

export function toPersistedRuleThreshold(
  ruleType: string,
  displayedValue: number,
) {
  return ruleType === "require_approval"
    ? Math.round(displayedValue * 100)
    : displayedValue;
}

export function toDisplayedRuleThreshold(
  ruleType: string,
  persistedValue: number,
) {
  return ruleType === "require_approval"
    ? persistedValue / 100
    : persistedValue;
}

export function formatRuleThreshold(
  ruleType: string,
  persistedValue: number,
) {
  if (ruleType !== "require_approval") {
    return new Intl.NumberFormat("fr-FR", {
      maximumFractionDigits: 2,
    }).format(persistedValue);
  }

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(persistedValue / 100);
}
