import type { TakeoffApplyRequest } from "@/lib/takeoff/types";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import {
  compareTakeoffJobsQuerySchema,
  getTakeoffJobDetailsQuerySchema,
  listTakeoffJobsQuerySchema,
  takeoffApplyPayloadSchema,
  takeoffDpgfComparisonQuerySchema,
  takeoffLineEvidencePanelQuerySchema,
  takeoffPriceSuggestionQuerySchema,
  takeoffRiskRadarQuerySchema,
  type CompareTakeoffJobsQuery,
  type GetTakeoffJobDetailsQuery,
  type ListTakeoffJobsQuery,
  type TakeoffDpgfComparisonQuery,
  type TakeoffLineEvidencePanelQuery,
  type TakeoffPriceSuggestionQuery,
  type TakeoffRiskRadarQuery,
} from "@/lib/takeoff/schemas";

export function parseListTakeoffJobsQuery(payload: unknown): ListTakeoffJobsQuery {
  return parseWithSchema(
    listTakeoffJobsQuerySchema,
    payload,
    "Parametres de requete invalides."
  );
}

export function parseGetTakeoffJobDetailsQuery(
  payload: unknown
): GetTakeoffJobDetailsQuery {
  return parseWithSchema(
    getTakeoffJobDetailsQuerySchema,
    payload,
    "Parametres de requete invalides."
  );
}

export function parseCompareTakeoffJobsQuery(
  payload: unknown
): CompareTakeoffJobsQuery {
  return parseWithSchema(
    compareTakeoffJobsQuerySchema,
    payload,
    "Parametres de comparaison invalides."
  );
}

export function parseTakeoffDpgfComparisonQuery(
  payload: unknown
): TakeoffDpgfComparisonQuery {
  return parseWithSchema(
    takeoffDpgfComparisonQuerySchema,
    payload,
    "Parametres de comparaison DPGF invalides."
  );
}

export function parseTakeoffLineEvidencePanelQuery(
  payload: unknown
): TakeoffLineEvidencePanelQuery {
  return parseWithSchema(
    takeoffLineEvidencePanelQuerySchema,
    payload,
    "Parametres du panneau preuves invalides."
  );
}

export function parseTakeoffPriceSuggestionQuery(
  payload: unknown
): TakeoffPriceSuggestionQuery {
  return parseWithSchema(
    takeoffPriceSuggestionQuerySchema,
    payload,
    "Parametres de suggestion de prix invalides."
  );
}

export function parseTakeoffRiskRadarQuery(
  payload: unknown
): TakeoffRiskRadarQuery {
  return parseWithSchema(
    takeoffRiskRadarQuerySchema,
    payload,
    "Parametres du radar de risque invalides."
  );
}

export function parseApplyTakeoffPayload(payload: unknown): TakeoffApplyRequest {
  return parseWithSchema(
    takeoffApplyPayloadSchema,
    payload,
    "Payload d'application takeoff invalide."
  );
}
