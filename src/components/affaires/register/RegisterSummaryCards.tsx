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
    <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
      <article className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--slate-500)]">
          Points ouverts
        </p>
        <p className="mt-1 text-xl font-semibold text-[var(--slate-900)]">
          {summary.openQuestionsCount}
        </p>
        <p className="mt-1 text-xs text-[var(--slate-500)]">
          {itemCount} visible{itemCount > 1 ? "s" : ""}
        </p>
      </article>
      <button
        type="button"
        className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/5 px-3 py-2 text-left transition-colors hover:bg-[var(--danger)]/10"
        onClick={() =>
          onApplyFilters({
            status: "open",
            severity: "critical",
            kind: null,
            cursor: null,
          })
        }
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--danger)]">
          Critiques
        </p>
        <p className="mt-1 text-xl font-semibold text-[var(--slate-900)]">
          {summary.criticalOpenCount}
        </p>
        <p className="mt-1 text-xs text-[var(--slate-500)]">Bloquant validation</p>
      </button>
      <article className="rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--warning)]">
          Non-critiques
        </p>
        <p className="mt-1 text-xl font-semibold text-[var(--slate-900)]">
          {summary.nonCriticalOpenCount}
        </p>
        <p className="mt-1 text-xs text-[var(--slate-500)]">Actifs, non bloquants</p>
      </article>
      <button
        type="button"
        className="rounded-xl border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-3 py-2 text-left transition-colors hover:bg-[var(--brand-blue)]/10"
        onClick={() =>
          onApplyFilters({
            status: "clarify_with_client",
            severity: null,
            kind: null,
            cursor: null,
          })
        }
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-blue)]">
          Clarif. client
        </p>
        <p className="mt-1 text-xl font-semibold text-[var(--slate-900)]">
          {summary.clarifyWithClientCount}
        </p>
        <p className="mt-1 text-xs text-[var(--slate-500)]">Bloque envoi client</p>
      </button>
    </div>
  );
}
