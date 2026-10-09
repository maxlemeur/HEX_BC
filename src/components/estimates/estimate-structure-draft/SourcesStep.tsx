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
        <div className="alert alert-info">
          Generation de la preview de structure et consolidation des preuves...
        </div>
      ) : null}
      {draftError ? <div className="alert alert-error">{draftError}</div> : null}
      {draft ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-border bg-surface-subtle p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Lots proposes
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {draft.summary.rootCount}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-subtle p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Nouveaux
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {draft.summary.newCount}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-subtle p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Fusions
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {draft.summary.mergeCount}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-subtle p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Doublons
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {draft.summary.duplicateCount}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-subtle p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Confiance faible
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {draft.summary.lowConfidenceCount}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Provenance utilisee
                </h3>
                {sourceCoverageSummary ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {sourceCoverageSummary}
                  </p>
                ) : null}
              </div>
            </div>
            {isAssemblyOnlyWeakMode ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Contexte pauvre detecte: aucune source metier forte n&apos;alimente la preview.
                Les suggestions issues uniquement des ouvrages sont marquees en faible confiance
                et ne sont pas preselectionnees.
              </div>
            ) : null}
            {draft.nodes.length === 0 ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                <p className="font-semibold">Aucune suggestion defendable</p>
                <p className="mt-1">
                  {isAssemblyOnlyWeakMode
                    ? "Les ouvrages disponibles restent visibles comme contexte, mais aucun lot n'est propose sans corroboration affaire plus solide."
                    : "Les sources disponibles ne permettent pas de proposer une structure IA suffisamment explicable pour cette version."}
                </p>
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {draft.sources.map((source) => (
                <div
                  key={source.kind}
                  className="rounded-xl border border-border bg-surface p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {sourceKindLabel(source.kind)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        source.used
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : source.available
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-border bg-muted text-slate-600"
                      }`}
                    >
                      {source.used
                        ? "utilisee"
                        : source.available
                          ? "disponible"
                          : "absente"}
                    </span>
                  </div>
                  {source.detail ? (
                    <p className="mt-2 text-sm text-slate-600">
                      {source.detail}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
