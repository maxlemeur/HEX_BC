"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";

import { PreviewImpactCard } from "./PreviewImpactCard";

export const IMPACT_TITLE = "Aperçu d’impact";

const plural = (count: number, singular: string, plural: string) => `${count} ${count > 1 ? plural : singular}`;

/**
 * The impact preview of the takeoff on the estimate, computed by the server for the chosen section: what is sent, what
 * stays out, what the mapping rules change. Computed without a click; on failure, said with « Réessayer ». Each new
 * computation is announced in a polite status, the section named, since nothing else tells a screen reader it changed.
 * Every count is the preview's: the lines excluded at the review too (its lines less those it retains), never a count the
 * review read before it (the re-check of 0fd09a20, finding 4: another reviewer may have excluded a line since).
 */
export function TakeoffApplyImpact({
  previewData,
  previewError,
  isLoadingPreview,
  sourceFileName,
  targetSectionLabel,
  isSubmitting,
  onRetry,
}: {
  previewData: TakeoffPreviewConversionResponse | null;
  previewError: string | null;
  isLoadingPreview: boolean;
  sourceFileName?: string | null;
  targetSectionLabel: string;
  isSubmitting: boolean;
  onRetry: () => void;
}) {
  return (
    <section aria-label={IMPACT_TITLE} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground">{IMPACT_TITLE}</h3>

      {/* Present from the first frame, so that each change of its text is announced. */}
      <p role="status" className={isLoadingPreview ? "text-sm text-muted-foreground" : "sr-only"}>
        {isLoadingPreview
          ? "Calcul de l’aperçu d’impact…"
          : previewData
            ? `Aperçu d’impact à jour pour « ${targetSectionLabel} » : ${plural(previewData.summary.included_count, "ligne retenue", "lignes retenues")}.`
            : ""}
      </p>

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
              value={previewData.summary.total_count - previewData.summary.included_count
                + previewData.summary.excluded_by_mapping_count}
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
