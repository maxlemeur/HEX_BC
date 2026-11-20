/**
 * T6 phase A - version du moteur de calcul des totaux.
 *
 * Module volontairement DEDIE :
 * il ne doit dependre d'aucun module chargeant `next/headers` ni Supabase, afin
 * de rester testable en pur, sans le moindre mock.
 *
 * `CalcEngineVersion` reste le domaine du moteur historique (1 | 2). Depuis le
 * lot 2 (sous-lot 2.1), une version peut porter le moteur 3 : elle n'est jamais
 * relue comme une v1 (voir `engine/capabilities.ts`).
 */

import {
  type CalcEngineVersion,
  EstimateEngineUnavailableError,
  type EstimateEngineVersion,
  EstimateEngineVersionError,
} from "@/lib/estimates/engine/capabilities";

const LEGACY_CALC_ENGINE_VERSION: CalcEngineVersion = 1;

/**
 * Moteur des nouvelles versions d'une entreprise sans ligne de politique : le moteur 3 depuis la
 * bascule (lot 2, sous-lot 2.10b, migration M8 `estimate_engine_v3_default`). Une politique 2
 * explicite garde le moteur 2 ; les versions existantes restent epinglees. Ce n'est pas un
 * `CalcEngineVersion` : le moteur 3 n'est jamais relu comme une v1 ni calcule par le moteur
 * historique (voir `engine/capabilities.ts`).
 */
export const NEW_ESTIMATE_CALC_ENGINE_VERSION = 3 as const satisfies EstimateEngineVersion;

const SUPPORTED_CALC_ENGINE_VERSIONS: readonly CalcEngineVersion[] = [1, 2];

/**
 * Resout le moteur historique d'une version de devis.
 *
 * Tolerant pour les valeurs heritees : absente, non finie ou inferieure a 1,
 * elle retombe sur le moteur historique (1) ; les valeurs fractionnaires sont
 * tronquees vers zero avant controle. Le moteur 3 n'est jamais relu comme une
 * v1 : il leve `EstimateEngineUnavailableError` ; au-dela, la valeur est
 * refusee (`ESTIMATE_CALC_ENGINE_UNSUPPORTED`).
 */
export function resolveCalcEngineVersion(
  version: { calc_engine_version?: number | null } | null | undefined
): CalcEngineVersion {
  const raw = version?.calc_engine_version;
  if (!Number.isFinite(raw ?? NaN)) return LEGACY_CALC_ENGINE_VERSION;
  const normalized = Math.trunc(raw as number);
  if (SUPPORTED_CALC_ENGINE_VERSIONS.includes(normalized as CalcEngineVersion)) {
    return normalized as CalcEngineVersion;
  }
  if (normalized === 3) throw new EstimateEngineUnavailableError();
  if (normalized > 3) {
    throw new EstimateEngineVersionError(
      "ESTIMATE_CALC_ENGINE_UNSUPPORTED",
      `Moteur de calcul non pris en charge : ${normalized}.`
    );
  }
  return LEGACY_CALC_ENGINE_VERSION;
}

/**
 * Lot 2, sous-lot 2.5 : meme tolerance historique que `resolveCalcEngineVersion`
 * pour les moteurs 1 et 2 (resultat identique), mais une v3 est rendue comme 3,
 * pour les chemins qui savent desormais l'aiguiller. Au-dela de 3 : refus.
 */
export function resolveEstimateEngineVersion(
  version: { calc_engine_version?: number | null } | null | undefined
): EstimateEngineVersion {
  const raw = version?.calc_engine_version;
  if (Number.isFinite(raw ?? NaN) && Math.trunc(raw as number) === 3) return 3;
  return resolveCalcEngineVersion(version);
}

/** Variante d'affichage de `resolveEstimateEngineVersion` : `null` pour un moteur inconnu. */
export function resolveEstimateEngineVersionForDisplay(
  version: { calc_engine_version?: number | null } | null | undefined
): EstimateEngineVersion | null {
  try {
    return resolveEstimateEngineVersion(version);
  } catch (error) {
    if (error instanceof EstimateEngineVersionError) return null;
    throw error;
  }
}

/**
 * Variante des surfaces d'affichage agregees (tableaux de bord, listes) : le
 * moteur historique, ou `null` pour un moteur qu'elles ne savent pas lire (v3),
 * affiche comme indisponible au lieu d'interrompre toute la page.
 */
export function resolveCalcEngineVersionForDisplay(
  version: { calc_engine_version?: number | null } | null | undefined
): CalcEngineVersion | null {
  try {
    return resolveCalcEngineVersion(version);
  } catch (error) {
    if (error instanceof EstimateEngineUnavailableError || error instanceof EstimateEngineVersionError) {
      return null;
    }
    throw error;
  }
}
