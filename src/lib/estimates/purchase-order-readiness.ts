export type PurchasePreparationCounts = {
  totalSupplierLines: number;
  draftableLines: number;
  transferredLines: number;
  blockedLines: number;
};

export type PurchaseOrderReadiness =
  | {
      status: "ready" | "warning" | "blocked" | "prepared" | "waiting";
      counts: PurchasePreparationCounts;
      errorMessage: null;
    }
  | {
      status: "checking" | "unavailable";
      counts: null;
      errorMessage: string;
    };

export function buildPurchaseOrderReadiness(
  counts: PurchasePreparationCounts,
): PurchaseOrderReadiness {
  if (
    !Object.values(counts).every((count) => Number.isSafeInteger(count) && count >= 0) ||
    counts.totalSupplierLines !== counts.draftableLines + counts.transferredLines + counts.blockedLines
  ) {
    return {
      status: "unavailable",
      counts: null,
      errorMessage: "Préparation indisponible. Rechargez pour vérifier les lignes.",
    };
  }

  const status = counts.draftableLines > 0
    ? counts.blockedLines > 0 ? "warning" : "ready"
    : counts.blockedLines > 0 ? "blocked"
      : counts.transferredLines > 0 ? "prepared" : "waiting";
  return { status, counts: { ...counts }, errorMessage: null };
}

export function formatPurchaseOrderReadinessSummary(
  readiness: PurchaseOrderReadiness,
): string {
  if (readiness.counts === null) return readiness.errorMessage;
  const { draftableLines, transferredLines, blockedLines } = readiness.counts;
  return `${draftableLines} ligne${draftableLines > 1 ? "s" : ""} préparable${draftableLines > 1 ? "s" : ""} · ` +
    `${transferredLines} ligne${transferredLines > 1 ? "s" : ""} déjà transférée${transferredLines > 1 ? "s" : ""} · ` +
    `${blockedLines} ligne${blockedLines > 1 ? "s" : ""} à corriger.`;
}
