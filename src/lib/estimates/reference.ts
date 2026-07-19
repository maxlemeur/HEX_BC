const DEFAULT_ESTIMATE_FILENAME = "devis";

export function formatEstimateReference(
  baseReference: string | null | undefined,
  versionNumber: number
): string | null {
  const normalizedReference = baseReference?.trim();
  if (!normalizedReference) return null;
  const normalizedVersionNumber = Number.isFinite(versionNumber)
    ? Math.max(1, Math.trunc(versionNumber))
    : 1;

  return normalizedVersionNumber > 1
    ? `${normalizedReference}_V${normalizedVersionNumber}`
    : normalizedReference;
}

export function sanitizeEstimateFilename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

export function buildEstimatePdfFilename(input: {
  baseReference?: string | null;
  versionNumber: number;
  fallback?: string | null;
}): string {
  const reference = formatEstimateReference(
    input.baseReference,
    input.versionNumber
  );
  const safeReference = sanitizeEstimateFilename(reference ?? "");
  const fallback = sanitizeEstimateFilename(input.fallback ?? "");
  const basename = safeReference || fallback || DEFAULT_ESTIMATE_FILENAME;

  return `${basename}.pdf`;
}
