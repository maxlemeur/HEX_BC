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
import { describeTakeoffRequestUnitState } from "@/lib/takeoff/request-activity";
import { describeTakeoffJobFailure } from "@/lib/takeoff/visible-status";


export function describeTakeoffTrackingStatus(input: {
  status: string;
  fallback: string;
  errorCode?: string | null;
  notStarted?: boolean;
  automaticStart?: boolean;
}): string {
  switch (input.status) {
    case "completed":
    case "applied":
      return describeTakeoffRequestUnitState({ state: "succeeded", retryAt: null }, null);
    case "processing":
      return describeTakeoffRequestUnitState({ state: "running", retryAt: null }, null);
    case "pending":
      return input.automaticStart ? "Reprise automatique" : describeTakeoffRequestUnitState({ state: "queued", retryAt: null }, null);
    case "canceled":
      return describeTakeoffRequestUnitState({ state: "canceled", retryAt: null }, null);
    case "failed":
      return `${input.notStarted ? "Non lu" : "Échec"} : ${describeTakeoffJobFailure(input.errorCode)}`;
    default:
      return input.fallback;
  }
}
