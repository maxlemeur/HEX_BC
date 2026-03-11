"use client";

type UnknownResolutionPanelProps = {
  unknownSuppliersCount: number;
  unknownProductsCount: number;
  rejectedRowsCount: number;
  isResolving: boolean;
  isCreatingMissing: boolean;
  isSubmitting: boolean;
  onResolveAutomatically: () => Promise<void>;
  onCreateMissing: () => Promise<void>;
  onDownloadCorrectionsCsv: () => void;
};

export function UnknownResolutionPanel({
  unknownSuppliersCount,
  unknownProductsCount,
  rejectedRowsCount,
  isResolving,
  isCreatingMissing,
  isSubmitting,
  onResolveAutomatically,
  onCreateMissing,
  onDownloadCorrectionsCsv,
}: Readonly<UnknownResolutionPanelProps>) {
  const hasUnknowns = unknownSuppliersCount > 0 || unknownProductsCount > 0;

  return (
    <section className="dashboard-card overflow-hidden">
      <div className="border-b border-[var(--slate-200)] px-6 py-4">
        <h3 className="text-sm font-semibold text-[var(--slate-800)]">Etape 3 - Resoudre les inconnus</h3>
        <p className="mt-1 text-xs text-[var(--slate-500)]">
          Fournisseurs inconnus: {unknownSuppliersCount} | Produits inconnus: {unknownProductsCount}
        </p>
      </div>
      <div className="px-6 py-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void onResolveAutomatically()}
          disabled={isResolving || isCreatingMissing || isSubmitting || !hasUnknowns}
        >
          {isResolving ? "Resolution..." : "Resoudre automatiquement"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void onCreateMissing()}
          disabled={isCreatingMissing || isResolving || isSubmitting || !hasUnknowns}
        >
          {isCreatingMissing ? "Creation..." : "Creer les inconnus"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onDownloadCorrectionsCsv}
          disabled={rejectedRowsCount === 0}
        >
          Exporter les corrections CSV
        </button>
      </div>
    </section>
  );
}
