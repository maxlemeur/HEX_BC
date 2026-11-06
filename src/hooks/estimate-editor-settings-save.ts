import { isEstimateApiError } from "@/lib/estimates/client";

/** Retry only a lock refusal; the caller retains ownership of settings and receipt publication. */
export async function persistEstimateSettingsWithLockRecovery<T>(input: {
  persist: () => Promise<T>;
  recoverLock: () => Promise<boolean>;
  isCurrent: () => boolean;
}): Promise<T> {
  if (!input.isCurrent()) throw new Error("Le document a changé. La sauvegarde des paramètres est annulée.");
  try {
    return await input.persist();
  } catch (error) {
    if (!input.isCurrent() || !isEstimateApiError(error) || error.code !== "LOCK_REQUIRED") throw error;
    const reacquired = await input.recoverLock();
    if (!input.isCurrent() || !reacquired) throw error;
    return input.persist();
  }
}
