/**
 * Lot 2, sous-lot 2.1 - capacites des moteurs de calcul (conception D1, §9).
 *
 * Module pur : aucune dependance a Next ni a Supabase. Deux types coexistent :
 * - `EstimateEngineVersion` (1 | 2 | 3), valeur stockee de toute version ;
 * - le moteur historique (1 | 2, `CalcEngineVersion`), seul accepte par
 *   `estimate-calculations.ts`, inchange.
 *
 * Tant que le moteur 3 n'est pas livre, tout chemin non adapte refuse une v3 par
 * `EstimateEngineUnavailableError` au lieu de la relire comme une v1.
 */

export type EstimateEngineVersion = 1 | 2 | 3;

/** Moteur historique : meme domaine que `CalcEngineVersion` (`calc-engine-version.ts`). */
type HistoricalEngineVersion = Exclude<EstimateEngineVersion, 3>;

export const ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE =
  "Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action.";

/** Refus nomme d'une action pas encore disponible en moteur 3 (HTTP 409 dans les routes). */
export class EstimateEngineUnavailableError extends Error {
  readonly code = "ESTIMATE_ENGINE_UNAVAILABLE";
  readonly status = 409;
  readonly engineVersion = 3;

  constructor() {
    super(ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE);
    this.name = "EstimateEngineUnavailableError";
  }
}

export type EstimateEngineVersionErrorCode =
  | "ESTIMATE_CALC_ENGINE_MISSING"
  | "ESTIMATE_CALC_ENGINE_UNSUPPORTED";

/** Colonne `calc_engine_version` absente ou hors domaine : jamais de moteur par defaut. */
export class EstimateEngineVersionError extends Error {
  readonly code: EstimateEngineVersionErrorCode;
  readonly status = 500;

  constructor(code: EstimateEngineVersionErrorCode, message: string) {
    super(message);
    this.name = "EstimateEngineVersionError";
    this.code = code;
  }
}

/** Branche impossible d'un aiguillage exhaustif sur le moteur. */
export function assertNever(value: never): never {
  throw new EstimateEngineVersionError(
    "ESTIMATE_CALC_ENGINE_UNSUPPORTED",
    `Moteur de calcul non pris en charge : ${String(value)}.`
  );
}

/**
 * Lecture stricte du moteur d'une ligne de version, pour les chemins
 * contractuels : la colonne doit etre portee par la ligne elle-meme (une liste
 * `select` qui l'oublie echoue) et valoir exactement 1, 2 ou 3.
 */
export function requireEstimateEngineVersion(
  row: object | null | undefined
): EstimateEngineVersion {
  if (!row || !Object.hasOwn(row, "calc_engine_version")) {
    throw new EstimateEngineVersionError(
      "ESTIMATE_CALC_ENGINE_MISSING",
      "Le moteur de calcul de la version est absent."
    );
  }
  const value = (row as { calc_engine_version?: unknown }).calc_engine_version;
  switch (value) {
    case 1:
    case 2:
    case 3:
      return value;
    default:
      throw new EstimateEngineVersionError(
        "ESTIMATE_CALC_ENGINE_UNSUPPORTED",
        `Moteur de calcul non pris en charge : ${String(value)}.`
      );
  }
}

/**
 * Chemin non encore adapte au moteur 3 : renvoie le moteur historique, ou
 * refuse une v3 par son nom.
 */
export function requireHistoricalEngine(engine: EstimateEngineVersion): HistoricalEngineVersion {
  switch (engine) {
    case 1:
    case 2:
      return engine;
    case 3:
      throw new EstimateEngineUnavailableError();
    default:
      return assertNever(engine);
  }
}

/** Le moteur fige un instantane de calcul (gouvernance v2, heritee par la v3). */
export function engineFreezesSnapshot(engine: EstimateEngineVersion): boolean {
  switch (engine) {
    case 1:
      return false;
    case 2:
    case 3:
      return true;
    default:
      return assertNever(engine);
  }
}

/** Moteur historique 1 (marge stockee, remise et sceau historiques). */
export function isLegacyEngine(engine: HistoricalEngineVersion): engine is 1 {
  return engine === 1;
}

/** Moteur historique 2 (moteur unifie, gel v2). */
export function isUnifiedEngine(engine: HistoricalEngineVersion): engine is 2 {
  return engine === 2;
}

/**
 * Lot 2, sous-lot 2.5 (D5) : coefficients de vente FO/MO par version, marge fixe a 1, contexte
 * fige v3 et marque nette (`cost_subtotal_cents`) au lieu du multiplicateur v2.
 */
export function usesSaleCoefficients(engine: EstimateEngineVersion): engine is 3 {
  switch (engine) {
    case 1:
    case 2:
      return false;
    case 3:
      return true;
    default:
      return assertNever(engine);
  }
}

/** Lot 2, sous-lot 2.5 (D4, D9) : heures par unite, unite et statut de ligne en colonnes. */
export function usesPerUnitLabor(engine: EstimateEngineVersion): engine is 3 {
  return usesSaleCoefficients(engine);
}
