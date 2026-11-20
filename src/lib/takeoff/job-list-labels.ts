export const BUSINESS_LEVEL_LABEL_MAP: Record<string, string> = {
  A: "Rapide",
  B: "Standard",
  C: "Détaillé",
};

export function getBusinessLevelLabel(level: string): string {
  return BUSINESS_LEVEL_LABEL_MAP[level] ?? level;
}

export function getConfidenceLabel(confidence: number | null): string {
  if (confidence === null) return "Inconnue";
  if (confidence >= 0.8) return "Élevée";
  if (confidence >= 0.5) return "Moyenne";
  return "Faible";
}
