"use client";

import type { ImportSummary } from "@/components/catalogue/price-book-csv-import/types";
import { formatNumber } from "@/components/catalogue/price-book-csv-import/utils";
import { Button } from "@/components/ui/button";

type PriceBookImportStepProps = {
  canSubmit: boolean;
  isSubmitting: boolean;
  isResolving: boolean;
  isCreatingMissing: boolean;
  importSummary: ImportSummary | null;
  onSubmitImport: () => Promise<void>;
};

export function PriceBookImportStep({
  canSubmit,
  isSubmitting,
  isResolving,
  isCreatingMissing,
  importSummary,
  onSubmitImport,
}: Readonly<PriceBookImportStepProps>) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-foreground">Étape 4 — Importer</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Vous pouvez importer les lignes prêtes maintenant, même si des corrections restent à faire.
      </p>

      <div className="mt-4">
        <Button
          variant="accent"
          size="lg"
          onClick={() => void onSubmitImport()}
          disabled={!canSubmit || isResolving || isCreatingMissing}
          loading={isSubmitting}
        >
          Importer les lignes prêtes
        </Button>
      </div>

      {importSummary ? (
        <p className="mt-3 text-xs text-foreground-secondary" role="status">
          Importées : {formatNumber(importSummary.imported)} · Ignorées (hors périmètre) :{" "}
          {formatNumber(importSummary.ignored)} · À corriger : {formatNumber(importSummary.toFix)} ·
          Déjà existantes : {formatNumber(importSummary.duplicatesSkipped)}
        </p>
      ) : null}
    </div>
  );
}
