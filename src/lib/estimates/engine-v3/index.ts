/**
 * Lot 2, sous-lot 2.4 - moteur de calcul v3 pur (conception §4, D13). Code inerte en 2.4 :
 * aucun écran ni écrivain ne l'appelle et aucune v3 ne peut être créée. Les moteurs 1 et 2
 * (`estimate-calculations.ts`, `estimate-v2-snapshot.ts`) ne sont ni importés ni modifiés.
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
