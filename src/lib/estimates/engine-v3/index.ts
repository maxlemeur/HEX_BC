/**
 * Moteur de calcul v3 pur, utilisé par les projections et les parcours v3.
 * La version de moteur reste épinglée sur chaque devis ; les moteurs historiques
 * 1 et 2 sont conservés séparément. Contrat : docs/metier/regles-de-calcul.md.
 */
export { allocateExact, type AllocationEntry } from "@/lib/estimates/engine-v3/allocate";
export { computeEstimateV3Breakdown } from "@/lib/estimates/engine-v3/breakdown";
export { computeEstimateV3Canonical } from "@/lib/estimates/engine-v3/canonical";
export {
  ESTIMATE_AMOUNT_OVERFLOW,
  ESTIMATE_V3_INPUT_INVALID,
  ESTIMATE_V3_STORED_INCOHERENT,
  EstimateV3Error,
  type EstimateV3ErrorCode,
} from "@/lib/estimates/engine-v3/errors";
export {
  computeEstimateV3NetMarginBp,
  type EstimateV3SnapshotContext,
  type EstimateV3SnapshotItem,
  type EstimateV3SnapshotProjection,
  type EstimateV3SnapshotVersion,
  projectEstimateV3Snapshot,
} from "@/lib/estimates/engine-v3/projection";
export {
  readStoredEstimateV3,
  type StoredEstimateV3Item,
  type StoredEstimateV3Line,
  type StoredEstimateV3Version,
  type StoredEstimateV3View,
} from "@/lib/estimates/engine-v3/stored";
export type * from "@/lib/estimates/engine-v3/types";
