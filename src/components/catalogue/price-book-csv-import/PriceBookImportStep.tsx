"use client";

import type { ImportSummary } from "@/components/catalogue/price-book-csv-import/types";
import { formatNumber } from "@/components/catalogue/price-book-csv-import/utils";

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
    <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-4">
      <h3 className="text-sm font-semibold text-[var(--slate-800)]">Etape 4 - Importer</h3>
      <p className="mt-1 text-xs text-[var(--slate-500)]">
        Vous pouvez importer les lignes pretes maintenant, meme si des corrections restent a faire.
      </p>

      <div className="mt-4">
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => void onSubmitImport()}
          disabled={!canSubmit || isResolving || isCreatingMissing}
        >
          {isSubmitting ? "Import..." : "Importer les lignes pretes"}
        </button>
      </div>

      {importSummary ? (
        <div className="mt-3 text-xs text-[var(--slate-600)]">
          Importees: {formatNumber(importSummary.imported)} | Ignorees (hors perimetre):{" "}
          {formatNumber(importSummary.ignored)} | A corriger: {formatNumber(importSummary.toFix)} |
          Deja existantes: {formatNumber(importSummary.duplicatesSkipped)}
        </div>
      ) : null}
    </div>
  );
}
