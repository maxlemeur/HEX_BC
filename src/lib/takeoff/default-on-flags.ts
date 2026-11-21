import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

export function readDefaultOnTakeoffFlag(name: "MERGEONE_TAKEOFF_VECTORS" | "MERGEONE_TAKEOFF_RULES", value: string | undefined) {
  if (value === undefined || value === "1") return true;
  if (value === "0") return false;
  throw new TakeoffError({ code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false,
    message: `Configuration du métré invalide : ${name} doit valoir 0 ou 1.`, details: { reason: "TAKEOFF_FLAG_INVALID", flag: name } });
}

export function assertTakeoffWorkerConfiguration() {
  readDefaultOnTakeoffFlag("MERGEONE_TAKEOFF_VECTORS", process.env.MERGEONE_TAKEOFF_VECTORS);
  readDefaultOnTakeoffFlag("MERGEONE_TAKEOFF_RULES", process.env.MERGEONE_TAKEOFF_RULES);
}
