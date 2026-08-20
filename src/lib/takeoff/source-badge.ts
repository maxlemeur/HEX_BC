const SUPPORTED_TAKEOFF_SOURCE_BADGE_PROVIDERS = new Set([
  "takeoff",
  "takeoff_gemini",
  "ai_structure",
  "generated_ouvrage",
  "version_zero_draft",
]);

/**
 * Un fournisseur de source non gere ne produit aucun badge de provenance. Les
 * appelants s'en servent pour savoir s'il y a quelque chose a afficher avant de
 * lui reserver de la place dans la ligne.
 */
export function hasTakeoffSourceBadge(
  sourceProvider: string | null | undefined
) {
  const normalized = sourceProvider?.trim().toLowerCase();
  return Boolean(
    normalized && SUPPORTED_TAKEOFF_SOURCE_BADGE_PROVIDERS.has(normalized)
  );
}

export { SUPPORTED_TAKEOFF_SOURCE_BADGE_PROVIDERS };
