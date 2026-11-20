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
