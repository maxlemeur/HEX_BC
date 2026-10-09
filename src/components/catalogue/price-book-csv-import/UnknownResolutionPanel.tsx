"use client";

import { Button } from "@/components/ui/button";

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
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-foreground">Étape 3 — Résoudre les inconnus</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Fournisseurs inconnus : {unknownSuppliersCount} · Produits inconnus : {unknownProductsCount}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 px-4 py-4 sm:px-6">
        <Button
          variant="outline"
          size="lg"
          onClick={() => void onResolveAutomatically()}
          disabled={isCreatingMissing || isSubmitting || !hasUnknowns}
          loading={isResolving}
        >
          Résoudre automatiquement
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => void onCreateMissing()}
          disabled={isResolving || isSubmitting || !hasUnknowns}
          loading={isCreatingMissing}
        >
          Créer les inconnus
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={onDownloadCorrectionsCsv}
          disabled={rejectedRowsCount === 0}
        >
          Exporter les corrections CSV
        </Button>
      </div>
    </section>
  );
}
