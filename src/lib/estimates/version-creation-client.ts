import { jsonRequest } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import { parseCreateEstimateResponse } from "@/lib/estimates/write-response-contracts";

export type CreateEstimateCreationMode = "blank" | "linkedDpgfSource";

export type CreateEstimatePayload = {
  projectName?: string;
  projectId?: string;
  title: string | null;
  dateDevis: string;
  validiteJours: number;
  marginMultiplier?: number;
  clientName?: string | null;
  reference?: string | null;
  marginMode?: "fixed" | "tiered";
  marginBp?: number;
  taxRateBp?: number;
  roundingMode?: "none" | "nearest" | "up" | "down";
  roundingStepCents?: number;
  currency?: string;
  projectNotes?: string | null;
  creationMode?: CreateEstimateCreationMode;
  /** Sous-lot 2.10a (D3) : moteur des nouvelles versions lu par la page ; envoyé tel quel. */
  expectedCalcEngineVersion?: 2 | 3;
  /** Moteur 3 seulement (D5). */
  saleCoefficientFo?: number;
  saleCoefficientMo?: number;
};

export async function createEstimate(
  input: CreateEstimatePayload
): Promise<string> {
  const projectName = input.projectName?.trim() ?? null;
  const projectId = input.projectId?.trim() ?? null;

  if (!projectId && !projectName) {
    throw new Error("projectName ou projectId est requis.");
  }

  const requestBody: Record<string, unknown> = {
    ...(input.creationMode
      ? {
          creation_mode:
            input.creationMode === "linkedDpgfSource"
              ? "linked_dpgf_source"
              : "blank",
        }
      : {}),
    version: {
      title: input.title,
      date_devis: input.dateDevis,
      validite_jours: input.validiteJours,
      // Ne pas forcer margin_multiplier: omettre la clé quand elle n'est pas
      // fournie laisse le serveur hériter de la marge de la dernière version
      // de l'affaire (sinon toute nouvelle version repart à 0 % de marge).
      ...(input.marginMultiplier != null
        ? { margin_multiplier: input.marginMultiplier }
        : {}),
      ...(input.marginMode ? { margin_mode: input.marginMode } : {}),
      ...(input.marginBp != null ? { margin_bp: input.marginBp } : {}),
      ...(input.taxRateBp != null ? { tax_rate_bp: input.taxRateBp } : {}),
      ...(input.roundingMode ? { rounding_mode: input.roundingMode } : {}),
      ...(input.roundingStepCents != null
        ? { rounding_step_cents: input.roundingStepCents }
        : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.saleCoefficientFo != null ? { sale_coefficient_fo: input.saleCoefficientFo } : {}),
      ...(input.saleCoefficientMo != null ? { sale_coefficient_mo: input.saleCoefficientMo } : {}),
      ...(input.expectedCalcEngineVersion != null
        ? { expected_calc_engine_version: input.expectedCalcEngineVersion }
        : {}),
    },
  };

  if (projectId) {
    requestBody.project_id = projectId;
  }

  if (projectName) {
    requestBody.project = {
      name: projectName,
      reference: input.reference ?? null,
      client_name: input.clientName ?? null,
      notes: input.projectNotes ?? null,
    };
  }

  const payload = await requestJson(
    "/api/estimates",
    jsonRequest("POST", requestBody),
    "Impossible de créer le chiffrage.",
    value => parseCreateEstimateResponse(value, projectId ?? undefined)
  );

  return payload.version.id;
}
