import { EstimateExplanationTrigger } from "@/components/estimates/EstimateExplanationTrigger";
import { formatEUR } from "@/lib/money";
import type {
  EstimateDiffEntry,
  EstimateDiffFieldChange,
  EstimateDiffMode,
  EstimateDiffResult,
} from "@/lib/estimates/diff";

type EstimateDiffViewProps = {
  diff: EstimateDiffResult;
  mode: EstimateDiffMode;
  versionId: string;
  compareVersionId: string;
  previousVersionLabel: string;
  currentVersionLabel: string;
};

const NUMERIC_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 3,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
});

function formatNumericValue(value: number) {
  return NUMERIC_FORMATTER.format(value);
}

function formatPercentValue(value: number) {
  return `${PERCENT_FORMATTER.format(value / 100)}%`;
}

function formatFieldValue(
  change: EstimateDiffFieldChange,
  value: string | number | null
) {
  if (value === null) return "-";
  if (change.kind === "money") {
    if (typeof value !== "number") return value;
    return formatEUR(value);
  }
  if (change.kind === "percent") {
    if (typeof value !== "number") return value;
    return formatPercentValue(value);
  }
  if (change.kind === "number") {
    if (typeof value !== "number") return value;
    return formatNumericValue(value);
  }
  return String(value);
}

function changeLabel(changeType: EstimateDiffEntry["changeType"]) {
  if (changeType === "added") return "Ajout";
  if (changeType === "removed") return "Suppression";
  return "Modification";
}

function changeBadgeClass(changeType: EstimateDiffEntry["changeType"]) {
  if (changeType === "added") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (changeType === "removed") {
    return "border border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border border-amber-200 bg-amber-50 text-amber-700";
}

function changeCardClass(changeType: EstimateDiffEntry["changeType"]) {
  if (changeType === "added") {
    return "border-emerald-200 bg-emerald-50/40";
  }
  if (changeType === "removed") {
    return "border-rose-200 bg-rose-50/40";
  }
  return "border-amber-200 bg-amber-50/40";
}

function formatItemType(itemType: EstimateDiffEntry["entityType"]) {
  return itemType === "section" ? "Section" : "Ligne";
}

function formatSectionPath(sectionPath: string[]) {
  if (sectionPath.length === 0) return "Racine";
  return sectionPath.join(" / ");
}

function formatDelta(cents: number) {
  const prefix = cents > 0 ? "+" : "";
  return `${prefix}${formatEUR(cents)}`;
}

function renderSnapshotLine(entry: EstimateDiffEntry) {
  const sourceItem = entry.afterItem ?? entry.beforeItem;
  if (!sourceItem || sourceItem.item_type !== "line") return null;

  return (
    <div className="mt-3 grid gap-1 text-xs text-slate-600 md:grid-cols-4">
      <span>Quantite: {sourceItem.quantity ?? "-"}</span>
      <span>PU HT: {formatEUR(sourceItem.unit_price_ht_cents ?? 0)}</span>
      <span>Total HT: {formatEUR(sourceItem.line_total_ht_cents ?? 0)}</span>
      <span>Total TTC: {formatEUR(sourceItem.line_total_ttc_cents ?? 0)}</span>
    </div>
  );
}

function InlineEntry({ entry }: { entry: EstimateDiffEntry }) {
  return (
    <article
      className={`rounded-xl border p-4 ${changeCardClass(entry.changeType)}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${changeBadgeClass(entry.changeType)}`}
            >
              {changeLabel(entry.changeType)}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {formatItemType(entry.entityType)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">{entry.title}</h3>
          <p className="text-xs text-muted-foreground">
            Section: {formatSectionPath(entry.sectionPath)}
          </p>
        </div>
      </header>

      {entry.changeType === "modified" ? (
        <div className="mt-4 space-y-2">
          {entry.fieldChanges.map((change) => (
            <div
              key={`${entry.key}:${change.field}`}
              className="grid gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm md:grid-cols-[180px_1fr_auto_1fr]"
            >
              <span className="font-medium text-secondary-foreground">{change.label}</span>
              <span className="text-muted-foreground line-through">
                {formatFieldValue(change, change.beforeValue)}
              </span>
              <span className="text-center text-slate-400">-&gt;</span>
              <span className="font-medium text-foreground">
                {formatFieldValue(change, change.afterValue)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        renderSnapshotLine(entry)
      )}
    </article>
  );
}

function SideBySideEntry({
  entry,
  previousVersionLabel,
  currentVersionLabel,
}: {
  entry: EstimateDiffEntry;
  previousVersionLabel: string;
  currentVersionLabel: string;
}) {
  return (
    <article
      className={`rounded-xl border p-4 ${changeCardClass(entry.changeType)}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${changeBadgeClass(entry.changeType)}`}
            >
              {changeLabel(entry.changeType)}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {formatItemType(entry.entityType)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">{entry.title}</h3>
          <p className="text-xs text-muted-foreground">
            Section: {formatSectionPath(entry.sectionPath)}
          </p>
        </div>
      </header>

      {entry.changeType === "modified" ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Champ</th>
                <th>{previousVersionLabel}</th>
                <th>{currentVersionLabel}</th>
              </tr>
            </thead>
            <tbody>
              {entry.fieldChanges.map((change) => (
                <tr key={`${entry.key}:${change.field}`}>
                  <td className="font-medium">{change.label}</td>
                  <td className="text-muted-foreground">
                    {formatFieldValue(change, change.beforeValue)}
                  </td>
                  <td className="font-semibold text-foreground">
                    {formatFieldValue(change, change.afterValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {entry.changeType !== "added" ? (
            <div className="rounded-lg border border-border bg-surface p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {previousVersionLabel}
              </p>
              <p className="font-medium text-foreground">
                {entry.beforeItem ? entry.beforeItem.title : "-"}
              </p>
              {entry.beforeItem?.item_type === "line" ? (
                <p className="mt-1 text-xs text-slate-600">
                  HT {formatEUR(entry.beforeItem.line_total_ht_cents ?? 0)} | TTC{" "}
                  {formatEUR(entry.beforeItem.line_total_ttc_cents ?? 0)}
                </p>
              ) : null}
            </div>
          ) : null}
          {entry.changeType !== "removed" ? (
            <div className="rounded-lg border border-border bg-surface p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {currentVersionLabel}
              </p>
              <p className="font-medium text-foreground">
                {entry.afterItem ? entry.afterItem.title : "-"}
              </p>
              {entry.afterItem?.item_type === "line" ? (
                <p className="mt-1 text-xs text-slate-600">
                  HT {formatEUR(entry.afterItem.line_total_ht_cents ?? 0)} | TTC{" "}
                  {formatEUR(entry.afterItem.line_total_ttc_cents ?? 0)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

export function EstimateDiffView({
  diff,
  mode,
  versionId,
  compareVersionId,
  previousVersionLabel,
  currentVersionLabel,
}: Readonly<EstimateDiffViewProps>) {
  if (diff.entries.length === 0) {
    return (
      <div className="dashboard-card p-6 text-sm text-slate-600">
        Aucun changement detecte entre les versions selectionnees.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="dashboard-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Resume des changements</h2>
          <EstimateExplanationTrigger
            kind="delta"
            versionId={versionId}
            compareVersionId={compareVersionId}
            currentVersionLabel={currentVersionLabel}
            compareVersionLabel={previousVersionLabel}
            triggerLabel="Expliquer le delta"
            surfaceLabel="Explication delta entre versions"
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Ajouts</p>
            <p className="text-lg font-semibold text-emerald-700">
              {diff.summary.addedCount}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Suppressions</p>
            <p className="text-lg font-semibold text-rose-700">
              {diff.summary.removedCount}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Modifications</p>
            <p className="text-lg font-semibold text-amber-700">
              {diff.summary.modifiedCount}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Delta HT</p>
            <p
              className={`text-lg font-semibold ${
                diff.summary.deltaHtCents >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {formatDelta(diff.summary.deltaHtCents)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Delta TTC</p>
            <p
              className={`text-lg font-semibold ${
                diff.summary.deltaTtcCents >= 0 ? "text-emerald-700" : "text-rose-700"
              }`}
            >
              {formatDelta(diff.summary.deltaTtcCents)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Totaux</p>
            <p className="text-xs text-slate-600">
              {previousVersionLabel}: HT {formatEUR(diff.summary.previousTotals.totalHtCents)} | TTC{" "}
              {formatEUR(diff.summary.previousTotals.totalTtcCents)}
            </p>
            <p className="text-xs text-foreground">
              {currentVersionLabel}: HT {formatEUR(diff.summary.currentTotals.totalHtCents)} | TTC{" "}
              {formatEUR(diff.summary.currentTotals.totalTtcCents)}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">

        {diff.entries.map((entry) =>
          mode === "inline" ? (
            <InlineEntry key={entry.key} entry={entry} />
          ) : (
            <SideBySideEntry
              key={entry.key}
              entry={entry}
              previousVersionLabel={previousVersionLabel}
              currentVersionLabel={currentVersionLabel}
            />
          )
        )}
      </section>
    </div>
  );
}
