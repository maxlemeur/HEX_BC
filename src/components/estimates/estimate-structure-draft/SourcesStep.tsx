import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { EstimateStructureDraft } from "@/lib/estimates/client";
import {
  isAssemblyOnlyWeakSignalMode,
  sourceKindLabel,
} from "@/lib/estimates/estimate-structure-draft";

type SourcesStepProps = {
  draft: EstimateStructureDraft | null;
  isLoadingDraft: boolean;
  draftError: string | null;
  sourceCoverageSummary: string | null;
};

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle p-4">
      <dt className="text-xs tracking-[0.18em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

export function SourcesStep({
  draft,
  isLoadingDraft,
  draftError,
  sourceCoverageSummary,
}: SourcesStepProps) {
  const isAssemblyOnlyWeakMode = draft
    ? isAssemblyOnlyWeakSignalMode(draft.sources)
    : false;

  return (
    <div className="space-y-4">
      {isLoadingDraft ? (
        <Alert variant="info">
          Génération de l&apos;aperçu de structure et consolidation des preuves…
        </Alert>
      ) : null}
      {draftError ? <Alert variant="danger">{draftError}</Alert> : null}
      {draft ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryTile label="Lots proposés" value={draft.summary.rootCount} />
            <SummaryTile label="Nouveaux" value={draft.summary.newCount} />
            <SummaryTile label="Fusions" value={draft.summary.mergeCount} />
            <SummaryTile label="Doublons" value={draft.summary.duplicateCount} />
            <SummaryTile
              label="Confiance faible"
              value={draft.summary.lowConfidenceCount}
            />
          </dl>

          <section
            aria-labelledby="estimate-structure-draft-sources-title"
            className="rounded-lg border border-border p-5"
          >
            <div>
              <h3
                id="estimate-structure-draft-sources-title"
                className="text-sm font-semibold text-foreground"
              >
                Provenance utilisée
              </h3>
              {sourceCoverageSummary ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {sourceCoverageSummary}
                </p>
              ) : null}
            </div>
            {isAssemblyOnlyWeakMode ? (
              <Alert variant="warning" className="mt-4">
                Contexte pauvre détecté : aucune source métier forte n&apos;alimente l&apos;aperçu.
                Les suggestions issues uniquement des ouvrages sont marquées en faible confiance
                et ne sont pas présélectionnées.
              </Alert>
            ) : null}
            {draft.nodes.length === 0 ? (
              <Alert variant="danger" role="status" className="mt-4">
                <AlertTitle>Aucune suggestion défendable</AlertTitle>
                <AlertDescription className="mt-1">
                  {isAssemblyOnlyWeakMode
                    ? "Les ouvrages disponibles restent visibles comme contexte, mais aucun lot n'est proposé sans corroboration plus solide de l'affaire."
                    : "Les sources disponibles ne permettent pas de proposer une structure IA suffisamment explicable pour cette version."}
                </AlertDescription>
              </Alert>
            ) : null}
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {draft.sources.map((source) => (
                <li
                  key={source.kind}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {sourceKindLabel(source.kind)}
                    </span>
                    <Badge
                      size="sm"
                      variant={
                        source.used
                          ? "success"
                          : source.available
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {source.used
                        ? "Utilisée"
                        : source.available
                          ? "Disponible"
                          : "Absente"}
                    </Badge>
                  </div>
                  {source.detail ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {source.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
