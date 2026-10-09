import { Badge } from "@/components/ui/badge";
import type { EstimateApprovalChangesSinceLastCycle } from "@/lib/estimates/rules-engine";

import { formatCurrencyDelta, formatDateTime } from "./shared";

function formatDiffCounts(added: number, updated: number, removed: number) {
  return `${added} ajouté(s) · ${updated} modifié(s) · ${removed} retiré(s)`;
}

export function ChangesSummarySection({
  changes,
}: Readonly<{
  changes: EstimateApprovalChangesSinceLastCycle | null;
}>) {
  if (!changes) {
    return null;
  }

  return (
    <section className="@container mt-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Ce qui a changé depuis le cycle {changes.sourceCycleNumber}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Écarts synthétiques depuis le {formatDateTime(changes.decidedAt)}.
          </p>
        </div>
        <Badge variant="neutral" size="sm">
          Écart HT {formatCurrencyDelta(changes.totalHtDeltaCents)}
        </Badge>
      </div>
      <div className="mt-3 grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
        <article className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Lots</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            {formatDiffCounts(
              changes.addedLotsCount,
              changes.updatedLotsCount,
              changes.removedLotsCount
            )}
          </p>
        </article>
        <article className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Lignes</p>
          <p className="mt-1 text-sm text-foreground-secondary">
            {formatDiffCounts(
              changes.addedLinesCount,
              changes.updatedLinesCount,
              changes.removedLinesCount
            )}
          </p>
        </article>
        <article className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Checklist
          </p>
          <p className="mt-1 text-sm text-foreground-secondary">
            {changes.treatedItemsCount} traité(s), {changes.toDiscussCount} à discuter
          </p>
        </article>
        <article className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Périmètres touchés
          </p>
          <p className="mt-1 break-words text-sm text-foreground-secondary">
            {changes.touchedLabels.length > 0
              ? changes.touchedLabels.join(", ")
              : "Aucun libellé remonté"}
          </p>
        </article>
      </div>
      {changes.settingsChanges.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {changes.settingsChanges.map((change) => (
            <li
              key={change.field}
              className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3 text-sm text-foreground-secondary"
            >
              <span className="font-medium text-foreground">{change.label}</span>
              {" : "}
              {change.before} → {change.after}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
