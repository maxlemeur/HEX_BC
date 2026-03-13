import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_SCOPE_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  type AffaireRegisterEntry,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterSummary,
} from "@/lib/affaires/register";

import { formatDateTime, SEVERITY_TONE, STATUS_TONE } from "./registerViewModel";

type RegisterSubmissionBlockersProps = {
  items: AffaireRegisterEntry[];
  summary: AffaireRegisterSummary;
  onApplyFilters: (next: {
    status?: AffaireRegisterEntryStatus | null;
    severity?: AffaireRegisterEntrySeverity | null;
    kind?: AffaireRegisterEntryKind | null;
    cursor?: string | null;
  }) => void;
};

function getBlockingEntries(items: AffaireRegisterEntry[]) {
  return items
    .filter(
      (entry) =>
        entry.status === "clarify_with_client" ||
        (entry.status === "open" && entry.severity === "critical"),
    )
    .sort((left, right) => {
      const leftRank = left.status === "open" && left.severity === "critical" ? 0 : 1;
      const rightRank = right.status === "open" && right.severity === "critical" ? 0 : 1;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
}

export function RegisterSubmissionBlockers({
  items,
  summary,
  onApplyFilters,
}: Readonly<RegisterSubmissionBlockersProps>) {
  const blockingEntries = getBlockingEntries(items);
  const totalBlockingCount =
    summary.criticalOpenCount + summary.clarifyWithClientCount;

  if (totalBlockingCount === 0) {
    return null;
  }

  const hiddenBlockingCount = Math.max(0, totalBlockingCount - blockingEntries.length);

  return (
    <section className="mt-4 rounded-2xl border border-[var(--danger)]/15 bg-[linear-gradient(180deg,rgba(255,247,237,0.98),rgba(255,255,255,0.96))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            À traiter avant remise
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">
            {totalBlockingCount} point{totalBlockingCount > 1 ? "s" : ""} bloque
            {totalBlockingCount > 1 ? "nt" : ""} encore la remise interne ou l&apos;envoi client.
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Ce bloc remonte les points bloquants visibles avec les données disponibles actuellement.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.criticalOpenCount > 0 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onApplyFilters({
                  status: "open",
                  severity: "critical",
                  kind: null,
                  cursor: null,
                })
              }
            >
              Voir les critiques
            </button>
          ) : null}
          {summary.clarifyWithClientCount > 0 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onApplyFilters({
                  status: "clarify_with_client",
                  severity: null,
                  kind: null,
                  cursor: null,
                })
              }
            >
              Voir les clarifications client
            </button>
          ) : null}
        </div>
      </div>

      {blockingEntries.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {blockingEntries.slice(0, 3).map((entry) => {
            const blockerMessage =
              entry.status === "clarify_with_client"
                ? "Retour client requis avant envoi."
                : "Point critique ouvert à arbitrer avant remise.";

            return (
              <article
                key={entry.id}
                className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
                    {AFFAIRE_REGISTER_KIND_LABELS[entry.kind]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${SEVERITY_TONE[entry.severity]}`}
                  >
                    {AFFAIRE_REGISTER_SEVERITY_LABELS[entry.severity]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[entry.status]}`}
                  >
                    {AFFAIRE_REGISTER_STATUS_LABELS[entry.status]}
                  </span>
                </div>
                <p className="mt-3 text-sm font-medium text-[var(--slate-900)]">
                  {entry.text}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--slate-500)]">
                  <span>
                    Contexte: {AFFAIRE_REGISTER_SCOPE_LABELS[entry.scopeType]} ·{" "}
                    {entry.scopeLabel}
                  </span>
                  {entry.sourceFileName ? <span>Source: {entry.sourceFileName}</span> : null}
                  <span>MAJ: {formatDateTime(entry.updatedAt)}</span>
                </div>
                <p className="mt-3 text-xs font-medium text-[var(--danger)]">
                  {blockerMessage}
                </p>
              </article>
            );
          })}

          {hiddenBlockingCount > 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--danger)]/20 bg-white/70 px-3 py-2 text-sm text-[var(--slate-600)]">
              {hiddenBlockingCount} autre
              {hiddenBlockingCount > 1 ? "s" : ""} point
              {hiddenBlockingCount > 1 ? "s" : ""} bloquant
              {hiddenBlockingCount > 1 ? "s" : ""} sur cette vue ou une autre tranche du registre.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--danger)]/20 bg-white/70 px-3 py-3 text-sm text-[var(--slate-600)]">
          Ces points bloquants ne sont pas visibles dans la vue courante. Utilisez les filtres
          pour les traiter en priorité.
        </div>
      )}
    </section>
  );
}
