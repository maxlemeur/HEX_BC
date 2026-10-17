import {
  computeEstimateBreakdown,
  type EstimateBreakdown,
  type EstimateComputationInput,
} from "@/lib/estimate-calculations";
import {
  assertNever,
  EstimateEngineUnavailableError,
  type EstimateEngineVersion,
} from "@/lib/estimates/engine/capabilities";

export type VersionComputationInput = Omit<EstimateComputationInput, "calcEngineVersion"> & {
  calcEngineVersion: EstimateEngineVersion;
};

/**
 * Facade de calcul d'une version (conception D1) : les moteurs 1 et 2 passent par le
 * moteur historique, a l'identique ; le moteur 3 est refuse par son nom jusqu'au
 * sous-lot 2.4 ; toute autre valeur est refusee, jamais calculee comme une v1.
 */
export function computeVersionBreakdown(input: VersionComputationInput): EstimateBreakdown {
  const engine = input.calcEngineVersion;
  switch (engine) {
    case 1:
    case 2:
      return computeEstimateBreakdown({ ...input, calcEngineVersion: engine });
    case 3:
      throw new EstimateEngineUnavailableError();
    default:
      return assertNever(engine);
  }
}
