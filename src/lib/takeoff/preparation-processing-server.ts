import "server-only";

import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffPreparationSchema, type TakeoffPreparation } from "@/lib/takeoff/preparation";
import type { TakeoffLevel, TakeoffProvider } from "@/lib/takeoff/types";

export type TakeoffRequestedProcessing = { level: TakeoffLevel; provider: TakeoffProvider };

export function assertTakeoffPreparationProcessing(
  preparation: TakeoffPreparation,
  requested?: TakeoffRequestedProcessing,
  allowLegacyReplay = false
) {
  if (preparation.processing.level === null) {
    if (allowLegacyReplay) return;
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
      message: "Choisissez le niveau d'analyse et le fournisseur, puis confirmez à nouveau la préparation.", retryable: false });
  }
  if (requested && (preparation.processing.level !== requested.level || preparation.processing.provider !== requested.provider)) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
      message: "Les réglages de traitement ont changé. Vérifiez le niveau et le fournisseur, puis confirmez à nouveau la préparation.", retryable: false });
  }
}

/** Old immutable jobs can replay without inventing settings absent at creation. */
export function assertReplayedTakeoffProcessing(job: { preparation_snapshot?: unknown }, requested: TakeoffRequestedProcessing) {
  if (job.preparation_snapshot === null || job.preparation_snapshot === undefined) return;
  const snapshot = job.preparation_snapshot as { preparation?: unknown };
  assertTakeoffPreparationProcessing(takeoffPreparationSchema.parse(snapshot.preparation), requested, true);
}
