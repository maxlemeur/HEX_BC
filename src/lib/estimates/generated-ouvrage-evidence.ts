export const GENERATED_OUVRAGE_EVIDENCE_KINDS = ["fact", "hypothesis", "inference"] as const;
export const GENERATED_OUVRAGE_RISK_SEVERITIES = ["info", "warning", "critical"] as const;

type StoredRiskSignal = {
  label: string;
  severity: (typeof GENERATED_OUVRAGE_RISK_SEVERITIES)[number];
  basis: (typeof GENERATED_OUVRAGE_EVIDENCE_KINDS)[number];
};

const MAX_EVIDENCE_ENTRIES = 8;

export function toNullableText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function clampConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value)));
}

export function readJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(toNullableText)
    .filter((entry): entry is string => entry !== null)
    .slice(0, MAX_EVIDENCE_ENTRIES);
}

// Saved evidence can contain obsolete entries. Keep the first eight valid ones in their original order.
export function normalizeRiskSignals(value: unknown): StoredRiskSignal[] {
  if (!Array.isArray(value)) return [];
  const signals: StoredRiskSignal[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const label = toNullableText(entry.label);
    const severity = GENERATED_OUVRAGE_RISK_SEVERITIES.find((known) => known === entry.severity);
    const basis = GENERATED_OUVRAGE_EVIDENCE_KINDS.find((known) => known === entry.basis);
    if (!label || !severity || !basis) continue;
    signals.push({ label, severity, basis });
    if (signals.length === MAX_EVIDENCE_ENTRIES) break;
  }
  return signals;
}
