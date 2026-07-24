/**
 * T6 phase A - version du moteur de calcul des totaux.
 *
 * Module volontairement DEDIE (et non fusionne avec un futur calc-context) :
 * il ne doit dependre d'aucun module chargeant `next/headers` ni Supabase, afin
 * de rester testable en pur, sans le moindre mock.
 *
 * Patron : `resolveEstimateCurrency` (editor-export.ts) - normalisation privee
 * et repli sur une constante `DEFAULT_` exportee, jamais d'exception.
 */

export type CalcEngineVersion = 1 | 2;

export const DEFAULT_CALC_ENGINE_VERSION: CalcEngineVersion = 1;

const SUPPORTED_CALC_ENGINE_VERSIONS: readonly CalcEngineVersion[] = [1, 2];

/**
 * Resout la version du moteur de calcul d'une version de devis.
 *
 * Tolerant par construction : toute valeur absente, non finie ou hors du jeu
 * supporte retombe sur `DEFAULT_CALC_ENGINE_VERSION` (1), qui est le moteur
 * actuel. Les valeurs fractionnaires sont tronquees vers zero avant controle.
 */
export function resolveCalcEngineVersion(
  version: { calc_engine_version?: number | null } | null | undefined
): CalcEngineVersion {
  const raw = version?.calc_engine_version;
  if (!Number.isFinite(raw ?? NaN)) return DEFAULT_CALC_ENGINE_VERSION;
  const normalized = Math.trunc(raw as number);
  return SUPPORTED_CALC_ENGINE_VERSIONS.includes(normalized as CalcEngineVersion)
    ? (normalized as CalcEngineVersion)
    : DEFAULT_CALC_ENGINE_VERSION;
}
