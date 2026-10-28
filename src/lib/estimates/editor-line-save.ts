import { createEstimateBatchAttempt } from "@/lib/estimates/batch-intentions";
import {
  batchEstimateOperations,
  bulkUpdateEstimateItems,
  type EstimateBatchOperation,
  type EstimateBatchOperationResult,
  type EstimateVersionToken,
} from "@/lib/estimates/client";
import type { EstimateVersionTotalsPatch } from "@/lib/estimates/editor-items";

export type EstimateLineSaveReceipt = {
  version: EstimateVersionToken;
  totals: EstimateVersionTotalsPatch | undefined;
  results: readonly EstimateBatchOperationResult[];
  linesCommitted: boolean;
};

/** Saves one captured set of edits. The editor alone applies its receipt to the current draft. */
export async function saveEstimateEditorLines(input: {
  version: EstimateVersionToken;
  operations: EstimateBatchOperation[];
  totals: EstimateVersionTotalsPatch | undefined;
  withDraftLockRecovery: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<EstimateLineSaveReceipt> {
  if (input.operations.length > 0) {
    // Reacquiring a lock must retry the same intention, with the same idempotency key.
    const attempt = createEstimateBatchAttempt();
    const result = await input.withDraftLockRecovery(() => batchEstimateOperations(
      input.version.id, input.version.updated_at, input.operations, { attempt }
    ));
    if (!result.committed) {
      const failed = result.results.find((entry) => entry.status === "error");
      throw new Error(failed?.message ?? "Une opération de sauvegarde groupée a échoué.");
    }
    const version = result.currentVersionToken?.updated_at === result.versionToken.updated_at
      ? result.currentVersionToken : result.versionToken;
    return { version, totals: result.totals, results: result.results, linesCommitted: true };
  }

  const totals = input.totals;
  if (totals) {
    const result = await input.withDraftLockRecovery(() => bulkUpdateEstimateItems(
      input.version.id, input.version.updated_at, [], totals
    ));
    return { version: result.versionToken, totals: result.totals ?? totals, results: [], linesCommitted: false };
  }

  return { version: input.version, totals: undefined, results: [], linesCommitted: false };
}
