import type { EstimateApprovalChangesSinceLastCycle } from "@/lib/estimates/rules-engine";

import { formatCurrencyDelta, formatDateTime } from "./shared";

export function ChangesSummarySection({
  changes,
}: Readonly<{
  changes: EstimateApprovalChangesSinceLastCycle | null;
}>) {
  if (!changes) {
    return null;
  }

  return (
    <section className="rounded-xl border border-border bg-surface px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            Ce qui a change depuis le cycle {changes.sourceCycleNumber}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Diff synthétique depuis le {formatDateTime(changes.decidedAt)}.
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-slate-600">
          Delta HT {formatCurrencyDelta(changes.totalHtDeltaCents)}
        </span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="rounded-xl border border-border bg-surface-subtle px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Lots</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            +{changes.addedLotsCount} / ~{changes.updatedLotsCount} / -{changes.removedLotsCount}
          </p>
        </article>
        <article className="rounded-xl border border-border bg-surface-subtle px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Lignes</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            +{changes.addedLinesCount} / ~{changes.updatedLinesCount} / -{changes.removedLinesCount}
          </p>
        </article>
        <article className="rounded-xl border border-border bg-surface-subtle px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Checklist</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            {changes.treatedItemsCount} traite(s), {changes.toDiscussCount} à discuter
          </p>
        </article>
        <article className="rounded-xl border border-border bg-surface-subtle px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Scopes touches</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            {changes.touchedLabels.length > 0 ? changes.touchedLabels.join(", ") : "Aucun libelle remonté"}
          </p>
        </article>
      </div>
      {changes.settingsChanges.length > 0 ? (
        <div className="mt-3 space-y-2">
          {changes.settingsChanges.map((change) => (
            <div
              key={change.field}
              className="rounded-xl border border-border bg-surface-subtle px-3 py-3 text-sm text-foreground-secondary"
            >
              <span className="font-medium text-slate-800">{change.label}</span>
              {" : "}
              {change.before} {"->"} {change.after}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
