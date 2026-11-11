/** The worker's automatic exclusion; a reviewer's own reason is a decision, never reopened as an alternative. */
export const VECTOR_ITEM_EXCLUSION_REASON = "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut.";

export function isUnselectedVectorReading(item: {
  is_excluded?: boolean; is_verified?: boolean; exclusion_reason?: string | null; metadata?: unknown;
}): boolean {
  if (!item.is_excluded || item.is_verified || item.exclusion_reason !== VECTOR_ITEM_EXCLUSION_REASON) return false;
  const metadata = item.metadata as { vector?: { kind?: unknown } } | null | undefined;
  return metadata?.vector?.kind === "network" || metadata?.vector?.kind === "insulation";
}
