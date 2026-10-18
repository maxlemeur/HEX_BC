import { usesPerUnitLabor, type EstimateEngineVersion } from "@/lib/estimates/engine/capabilities";

/**
 * Lot 2, P-19 (sous-lot 2.5) puis 2.10a (N3, D-f) : le métré ne s'applique pas à une v3. Le refus nommé, d'abord
 * posé à l'application seulement, est aussi dit avant tout travail : à la création d'une tâche de métré (API et
 * actions du hub) et dans les entrées de l'interface qui la lancent. Module pur, partagé par le serveur et l'UI.
 */
export const TAKEOFF_ENGINE_V3_UNSUPPORTED_MESSAGE = "Le métré ne s'applique pas à un devis en moteur de calcul 3.";

/** Motif affiché par une entrée de métré dont la version cible est une v3 ; `null` sinon (moteur inconnu compris). */
export function takeoffTargetEngineRefusal(engine: EstimateEngineVersion | null | undefined): string | null {
  return engine != null && usesPerUnitLabor(engine) ? TAKEOFF_ENGINE_V3_UNSUPPORTED_MESSAGE : null;
}
