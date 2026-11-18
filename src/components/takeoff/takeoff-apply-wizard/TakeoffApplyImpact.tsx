"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";

import { PreviewImpactCard } from "./PreviewImpactCard";

export const IMPACT_TITLE = "Aperçu d’impact";

/**
 * The impact preview of the takeoff on the estimate, computed by the server for the chosen section: what is sent, what
 * stays out, what the mapping rules change. Computed without a click; on failure, said with « Réessayer ».
 */
export function TakeoffApplyImpact({
  previewData,
  previewError,
  isLoadingPreview,
  excludedCount,
  sourceFileName,
  isSubmitting,
  onRetry,
}: {
  previewData: TakeoffPreviewConversionResponse | null;
  previewError: string | null;
  isLoadingPreview: boolean;
  /** The lines excluded at the review. */
  excludedCount: number;
  sourceFileName?: string | null;
  isSubmitting: boolean;
  onRetry: () => void;
}) {
  return (
    <section aria-label={IMPACT_TITLE} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{IMPACT_TITLE}</h3>

      {isLoadingPreview ? (
        <p role="status" className="text-sm text-muted-foreground">Calcul de l’aperçu d’impact…</p>
      ) : null}

      {previewError ? (
        <Alert variant="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0">{previewError}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={isSubmitting}>
              Réessayer
            </Button>
          </div>
        </Alert>
      ) : null}

      {previewData ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PreviewImpactCard
              label="Lignes retenues"
              value={previewData.summary.included_count}
              hint="lignes du métré gardées à la revue"
            />
            <PreviewImpactCard
              label="Écartées"
              value={excludedCount + previewData.summary.excluded_by_mapping_count}
              hint="exclues à la revue, laissées de côté ou remplacées par un ouvrage"
            />
            <PreviewImpactCard
              label="Ouvrages"
              value={previewData.summary.assembly_insertions_count}
              hint="ouvrages insérés à la place de lignes"
            />
            <PreviewImpactCard
              label="Modifiées par une règle"
              value={previewData.summary.transformed_count}
              hint="règles de correspondance de l’administrateur"
            />
          </div>
          <p className="text-sm text-foreground-secondary">
            Source du métré : <strong className="font-medium text-foreground">{sourceFileName ?? "métré"}</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            Rien n’est écrit dans le devis avant votre confirmation.
          </p>
        </>
      ) : null}
    </section>
  );
}
