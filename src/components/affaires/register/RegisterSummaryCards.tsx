import type {
  AffaireRegisterEntryKind,
  AffaireRegisterEntrySeverity,
  AffaireRegisterEntryStatus,
  AffaireRegisterSummary,
} from "@/lib/affaires/register";

type RegisterSummaryCardsProps = {
  itemCount: number;
  summary: AffaireRegisterSummary;
  onApplyFilters: (next: {
    status?: AffaireRegisterEntryStatus | null;
    severity?: AffaireRegisterEntrySeverity | null;
    kind?: AffaireRegisterEntryKind | null;
    cursor?: string | null;
  }) => void;
};

export function RegisterSummaryCards({
  itemCount,
  summary,
  onApplyFilters,
}: Readonly<RegisterSummaryCardsProps>) {
  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <article className="rounded-xl border border-border bg-surface-subtle px-3 py-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            Points ouverts
          </p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {summary.openQuestionsCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {itemCount} visible{itemCount > 1 ? "s" : ""}
          </p>
        </article>
        <button
          type="button"
          className="rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-left transition-colors hover:bg-danger/10"
          onClick={() =>
            onApplyFilters({
              status: "open",
              severity: "critical",
              kind: null,
              cursor: null,
            })
          }
        >
          <p className="text-micro font-semibold uppercase tracking-wide text-danger">
            Critiques
          </p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {summary.criticalOpenCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Bloquant validation</p>
        </button>
        <article className="rounded-xl border border-warning/20 bg-warning/5 px-3 py-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-warning">
            Non-critiques
          </p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {summary.nonCriticalOpenCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Actifs, non bloquants</p>
        </article>
        <button
          type="button"
          className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10"
          onClick={() =>
            onApplyFilters({
              status: "clarify_with_client",
              severity: null,
              kind: null,
              cursor: null,
            })
          }
        >
          <p className="text-micro font-semibold uppercase tracking-wide text-primary">
            Clarif. client
          </p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {summary.clarifyWithClientCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Bloque envoi client</p>
        </button>
      </div>

      {summary.openAssumptionCount > 0 || summary.openMissingPieceCount > 0 ? (
        <div className="grid gap-2 md:grid-cols-2">
          {summary.openAssumptionCount > 0 ? (
            <button
              type="button"
              className="rounded-xl border border-warning/20 bg-surface px-3 py-2 text-left transition-colors hover:bg-warning/5"
              onClick={() =>
                onApplyFilters({
                  status: "open",
                  severity: null,
                  kind: "assumption",
                  cursor: null,
                })
              }
            >
              <p className="text-micro font-semibold uppercase tracking-wide text-warning">
                Hypothèses ouvertes
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {summary.openAssumptionCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Traces de continuation et points à confirmer
              </p>
            </button>
          ) : null}

          {summary.openMissingPieceCount > 0 ? (
            <button
              type="button"
              className="rounded-xl border border-danger/20 bg-surface px-3 py-2 text-left transition-colors hover:bg-danger/5"
              onClick={() =>
                onApplyFilters({
                  status: "open",
                  severity: null,
                  kind: "missing_piece",
                  cursor: null,
                })
              }
            >
              <p className="text-micro font-semibold uppercase tracking-wide text-danger">
                Pièces manquantes suivies
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {summary.openMissingPieceCount}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Manques traces dans le registre pour la suite du dossier
              </p>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
