/**
 * Lot 2, sous-lot 2.6 - aiguillage moteur de l'éditeur (conception §9 : aiguillage exhaustif,
 * `assertNever`). Les fichiers saturés de l'éditeur (`useEstimateEditorState.impl.tsx`,
 * `useEstimateEditorSyncController.ts`) délèguent ici chaque choix qui dépend du moteur : une v1/v2
 * garde exactement son chemin historique (mêmes appels, mêmes arguments), une v3 n'est jamais
 * relue par le moteur historique ni normalisée en v2 (D1, D2).
 */
import {
  computeInitialDiscountCents,
  computeStoredDiscountCents,
  normalizeDraftItems,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import { type CalcEngineVersion, resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  assertNever,
  type EstimateEngineVersion,
  requireHistoricalEngine,
  usesSaleCoefficients,
} from "@/lib/estimates/engine/capabilities";
import type { EstimateItemUpdatePayload } from "@/lib/estimates/editor-items";
import type { MarginTier } from "@/lib/estimates/margin-tiers";
import { toEstimateV3ItemWrite } from "@/lib/estimates/v3-editor";

type EngineVersionSource = { calc_engine_version?: number | null } | null | undefined;
type DraftNormalizationInput<T extends EstimateItemRecord> = Omit<Parameters<typeof normalizeDraftItems<T>>[0], "calcEngineVersion"> & {
  version: Parameters<typeof normalizeDraftItems<T>>[0]["version"] & { status?: string | null };
};

/** Moteur de la version ouverte : 1, 2 ou 3 ; au-delà, refus nommé (jamais relu comme une v1). */
export function resolveEditorEngine(version: EngineVersionSource): EstimateEngineVersion {
  return resolveEstimateEngineVersion(version);
}

/**
 * Moteur de la version ouverte et moteur historique de la grille. Pour une v3, `historical` vaut 2
 * pour la seule agrégation des nets de ligne des sections (`preserveStoredSnapshot`, une somme, sans
 * calcul) : chaque calcul v1/v2 de l'éditeur (aperçu, normalisation, remise, totaux) est écarté par
 * `isV3`, et la v3 lit ses montants dans l'aperçu du moteur pur.
 */
export function resolveEditorEngineContext(version: EngineVersionSource): {
  engine: EstimateEngineVersion;
  isV3: boolean;
  historical: CalcEngineVersion;
} {
  const engine = resolveEditorEngine(version);
  if (usesSaleCoefficients(engine)) return { engine, isV3: true, historical: 2 };
  return { engine, isV3: false, historical: requireHistoricalEngine(engine) };
}

/**
 * Le pied v2 stocké se réconcilie depuis les totaux de l'éditeur (moteur 2 seulement). Une v3 n'en
 * envoie jamais : chaque écriture est recalculée par le serveur (2.5), sans total client.
 */
export function reconcilesEditorTotals(version: EngineVersionSource): boolean {
  const engine = resolveEditorEngine(version);
  switch (engine) {
    case 1:
      return false;
    case 2:
      return true;
    case 3:
      return false;
    default:
      return assertNever(engine);
  }
}

/** Charge de ligne envoyée par la sauvegarde groupée : une v3 n'envoie ni heures totales ni projection. */
export function toEngineItemWrite(payload: EstimateItemUpdatePayload, version: EngineVersionSource): EstimateItemUpdatePayload {
  const engine = resolveEditorEngine(version);
  switch (engine) {
    case 1:
    case 2:
      return payload;
    case 3:
      return toEstimateV3ItemWrite(payload);
    default:
      return assertNever(engine);
  }
}

/** Normalisation d'un brouillon relu : chemin historique pour une v1/v2, lignes telles quelles en v3. */
export function normalizeEditorDraftItems<T extends EstimateItemRecord>(input: DraftNormalizationInput<T>): T[] {
  if (input.version.status !== "draft") return input.items;
  const engine = resolveEditorEngine(input.version);
  if (usesSaleCoefficients(engine)) return input.items;
  return normalizeDraftItems({ ...input, calcEngineVersion: requireHistoricalEngine(engine) });
}

/** Remise initiale des réglages v1/v2 ; sans objet en v3, dont la remise est une intention (D6). */
export function resolveEditorInitialDiscountCents(input: {
  version: Parameters<typeof computeInitialDiscountCents>[0] & { status?: string | null; calc_engine_version?: number | null };
  items: EstimateItemRecord[];
  rateById: Map<string, number>;
  rateAtelierById: Map<string, number>;
  rateChantierById: Map<string, number>;
  isLaborSplitEnabled: boolean;
  marginTiers: MarginTier[];
}): number {
  const engine = resolveEditorEngine(input.version);
  if (usesSaleCoefficients(engine)) return 0;
  const calcEngineVersion = requireHistoricalEngine(engine);
  if (input.version.status === "draft") {
    return computeInitialDiscountCents(input.version, input.items, input.rateById, input.isLaborSplitEnabled,
      input.rateAtelierById, input.rateChantierById, { calcEngineVersion, marginTiers: input.marginTiers });
  }
  switch (calcEngineVersion) {
    case 1:
      return computeStoredDiscountCents(input.version, input.items);
    case 2:
      return 0;
    default:
      return assertNever(calcEngineVersion);
  }
}
