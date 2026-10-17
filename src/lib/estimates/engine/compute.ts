import {
  computeEstimateBreakdown,
  type EstimateBreakdown,
  type EstimateComputationInput,
} from "@/lib/estimate-calculations";
import {
  assertNever,
  EstimateEngineUnavailableError,
} from "@/lib/estimates/engine/capabilities";
import {
  computeEstimateV3Breakdown,
  type EstimateV3Breakdown,
  type EstimateV3Input,
} from "@/lib/estimates/engine-v3";

/** Entrée du moteur historique (1 ou 2), inchangée. */
export type HistoricalVersionComputationInput = Omit<EstimateComputationInput, "calcEngineVersion"> & {
  calcEngineVersion: 1 | 2;
};

/** Entrée du moteur 3 : sa propre forme (colonnes v3), jamais une entrée v2 réinterprétée. */
export type EstimateV3VersionComputationInput = {
  calcEngineVersion: 3;
  v3: EstimateV3Input;
};

export type VersionComputationInput =
  | HistoricalVersionComputationInput
  | EstimateV3VersionComputationInput;

/** Résultat discriminé : un calcul v3 n'est jamais converti en `EstimateBreakdown` v2. */
export type VersionBreakdown = EstimateBreakdown | EstimateV3Breakdown;

/**
 * Facade de calcul d'une version (conception D1) : les moteurs 1 et 2 passent par le
 * moteur historique, a l'identique ; le moteur 3 passe par le moteur v3 pur (2.4) et rend
 * son propre type. Un appel v3 de forme v1/v2 (appelant non adapte, sans entree `v3`) est
 * refuse par son nom ; toute autre valeur est refusee, jamais calculee comme une v1.
 */
export function computeVersionBreakdown(input: HistoricalVersionComputationInput): EstimateBreakdown;
export function computeVersionBreakdown(input: EstimateV3VersionComputationInput): EstimateV3Breakdown;
export function computeVersionBreakdown(input: VersionComputationInput): VersionBreakdown;
export function computeVersionBreakdown(input: VersionComputationInput): VersionBreakdown {
  switch (input.calcEngineVersion) {
    case 1:
    case 2:
      return computeEstimateBreakdown({ ...input, calcEngineVersion: input.calcEngineVersion });
    case 3: {
      const v3 = (input as Partial<EstimateV3VersionComputationInput>).v3;
      if (!v3) throw new EstimateEngineUnavailableError();
      return computeEstimateV3Breakdown(v3);
    }
    default:
      return assertNever((input as { calcEngineVersion: unknown }).calcEngineVersion as never);
  }
}
