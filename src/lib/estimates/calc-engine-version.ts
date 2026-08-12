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

const LEGACY_CALC_ENGINE_VERSION: CalcEngineVersion = 1;

/** Moteur attribue aux nouvelles versions. Les versions existantes restent epinglees. */
export const NEW_ESTIMATE_CALC_ENGINE_VERSION: CalcEngineVersion = 2;

const SUPPORTED_CALC_ENGINE_VERSIONS: readonly CalcEngineVersion[] = [1, 2];

/**
 * Resout la version du moteur de calcul d'une version de devis.
 *
 * Tolerant par construction : toute valeur absente, non finie ou hors du jeu
 * supporte retombe sur le moteur historique (1). Les valeurs fractionnaires
 * sont tronquees vers zero avant controle.
 */
export function resolveCalcEngineVersion(
  version: { calc_engine_version?: number | null } | null | undefined
): CalcEngineVersion {
  const raw = version?.calc_engine_version;
  if (!Number.isFinite(raw ?? NaN)) return LEGACY_CALC_ENGINE_VERSION;
  const normalized = Math.trunc(raw as number);
  return SUPPORTED_CALC_ENGINE_VERSIONS.includes(normalized as CalcEngineVersion)
    ? (normalized as CalcEngineVersion)
    : LEGACY_CALC_ENGINE_VERSION;
}

/**
 * Indique si les montants figes d'une version v2 decrivent exactement sa
 * revision courante. Le statut n'entre volontairement pas dans ce contrat :
 * une revue peut figer un brouillon avant son approbation, tandis qu'une
 * mutation ulterieure rend automatiquement ce snapshot obsolete.
 */
export function hasFreshEstimateV2Snapshot(
  version:
    | {
        calc_engine_version?: number | null;
        content_revision?: number | null;
        calc_snapshot_content_revision?: number | null;
      }
    | null
    | undefined
): boolean {
  const contentRevision = version?.content_revision;
  const snapshotRevision = version?.calc_snapshot_content_revision;

  return (
    resolveCalcEngineVersion(version) === 2 &&
    Number.isInteger(contentRevision) &&
    Number.isInteger(snapshotRevision) &&
    snapshotRevision === contentRevision
  );
}

/**
 * Politique de lecture des surfaces contractuelles v2.
 *
 * - un brouillon n'utilise le snapshot que lorsqu'il correspond a sa revision ;
 * - une version finalisee ne recharge jamais des tarifs ou flags vivants. Les
 *   rares v2 historiques sans nouvelles colonnes utilisent ainsi le repli
 *   stocke et deterministe de `buildStoredEstimateBreakdown`.
 */
export function shouldPreserveStoredEstimateV2Snapshot(
  version:
    | {
        calc_engine_version?: number | null;
        content_revision?: number | null;
        calc_snapshot_content_revision?: number | null;
        status?: string | null;
      }
    | null
    | undefined
): boolean {
  return (
    resolveCalcEngineVersion(version) === 2 &&
    ((typeof version?.status === "string" && version.status !== "draft") ||
      hasFreshEstimateV2Snapshot(version))
  );
}
