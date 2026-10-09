import { ArrowRightIcon } from "lucide-react";

import { EstimateExplanationTrigger } from "@/components/estimates/EstimateExplanationTrigger";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/utils";
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

function changeBadgeVariant(changeType: EstimateDiffEntry["changeType"]): BadgeProps["variant"] {
  if (changeType === "added") return "success";
  if (changeType === "removed") return "danger";
  return "warning";
}

/** Coloured left edge: the change type stays readable without relying on a tinted background. */
function changeCardClass(changeType: EstimateDiffEntry["changeType"]) {
  if (changeType === "added") return "border-l-success";
  if (changeType === "removed") return "border-l-danger";
  return "border-l-warning";
}

function EntryHeader({ entry }: { entry: EstimateDiffEntry }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={changeBadgeVariant(entry.changeType)} size="sm">
            {changeLabel(entry.changeType)}
          </Badge>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {formatItemType(entry.entityType)}
          </span>
        </div>
        <h3 className="break-words text-sm font-semibold text-foreground">{entry.title}</h3>
        <p className="text-xs text-muted-foreground">
          Section : {formatSectionPath(entry.sectionPath)}
        </p>
      </div>
    </header>
  );
}

const entryCardClass = "rounded-lg border border-l-4 border-border bg-surface p-4 shadow-card";

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
    <div className="mt-3 grid gap-1 text-xs text-foreground-secondary sm:grid-cols-2 md:grid-cols-4">
      <span>Quantité : {sourceItem.quantity ?? "-"}</span>
      <span>PU HT : {formatEUR(sourceItem.unit_price_ht_cents ?? 0)}</span>
      <span>Total HT : {formatEUR(sourceItem.line_total_ht_cents ?? 0)}</span>
      <span>Total TTC : {formatEUR(sourceItem.line_total_ttc_cents ?? 0)}</span>
    </div>
  );
}

function InlineEntry({ entry }: { entry: EstimateDiffEntry }) {
  return (
    <article className={cn(entryCardClass, changeCardClass(entry.changeType))}>
      <EntryHeader entry={entry} />

      {entry.changeType === "modified" ? (
        <div className="mt-4 space-y-2">
          {entry.fieldChanges.map((change) => (
            <div
              key={`${entry.key}:${change.field}`}
              className="grid gap-x-2 gap-y-1 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm md:grid-cols-[180px_1fr_auto_1fr] md:items-center"
            >
              <span className="font-medium text-foreground-secondary">{change.label}</span>
              <span className="text-muted-foreground line-through">
                <span className="sr-only">Avant : </span>
                {formatFieldValue(change, change.beforeValue)}
              </span>
              <ArrowRightIcon aria-hidden="true" className="hidden size-3.5 text-subtle-foreground md:block" />
              <span className="font-medium text-foreground">
                <span className="sr-only">Après : </span>
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
    <article className={cn(entryCardClass, changeCardClass(entry.changeType))}>
      <EntryHeader entry={entry} />

      {entry.changeType === "modified" ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
          <table className="data-table w-full [&_td]:break-words">
            <thead>
              <tr>
                <th scope="col">Champ</th>
                <th scope="col">{previousVersionLabel}</th>
                <th scope="col">{currentVersionLabel}</th>
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
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {entry.changeType !== "added" ? (
            <div className="rounded-lg border border-border bg-surface p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {previousVersionLabel}
              </p>
              <p className="font-medium text-foreground">
                {entry.beforeItem ? entry.beforeItem.title : "-"}
              </p>
              {entry.beforeItem?.item_type === "line" ? (
                <p className="mt-1 text-xs text-foreground-secondary">
                  HT {formatEUR(entry.beforeItem.line_total_ht_cents ?? 0)} · TTC{" "}
                  {formatEUR(entry.beforeItem.line_total_ttc_cents ?? 0)}
                </p>
              ) : null}
            </div>
          ) : null}
          {entry.changeType !== "removed" ? (
            <div className="rounded-lg border border-border bg-surface p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {currentVersionLabel}
              </p>
              <p className="font-medium text-foreground">
                {entry.afterItem ? entry.afterItem.title : "-"}
              </p>
              {entry.afterItem?.item_type === "line" ? (
                <p className="mt-1 text-xs text-foreground-secondary">
                  HT {formatEUR(entry.afterItem.line_total_ht_cents ?? 0)} · TTC{" "}
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
  // Une remise, un coefficient global ou un arrondi modifie le total de version
  // sans changer aucune ligne (diff.entries reste vide). Ne masquer le résumé
  // que lorsqu'il n'y a NI changement de ligne NI écart de total.
  const hasTotalDelta =
    diff.summary.deltaHtCents !== 0 || diff.summary.deltaTtcCents !== 0;

  if (diff.entries.length === 0 && !hasTotalDelta) {
    return (
      <EmptyState
        title="Aucun changement détecté"
        description="Les deux versions sélectionnées ont le même contenu et les mêmes totaux."
        headingLevel={2}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <section aria-labelledby="estimate-diff-summary-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 id="estimate-diff-summary-title" className="text-sm font-semibold text-foreground">
              Résumé des changements
            </h2>
            <EstimateExplanationTrigger
              kind="delta"
              versionId={versionId}
              compareVersionId={compareVersionId}
              currentVersionLabel={currentVersionLabel}
              compareVersionLabel={previousVersionLabel}
              triggerLabel="Expliquer l’écart"
              surfaceLabel="Explication de l’écart entre versions"
            />
          </div>
          <dl className="mt-3 grid gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Ajouts</dt>
              <dd className="text-lg font-semibold tabular-nums text-success">
                {diff.summary.addedCount}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Suppressions</dt>
              <dd className="text-lg font-semibold tabular-nums text-danger">
                {diff.summary.removedCount}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Modifications</dt>
              <dd className="text-lg font-semibold tabular-nums text-warning">
                {diff.summary.modifiedCount}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Écart HT</dt>
              <dd
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  diff.summary.deltaHtCents >= 0 ? "text-success" : "text-danger"
                )}
              >
                {formatDelta(diff.summary.deltaHtCents)}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Écart TTC</dt>
              <dd
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  diff.summary.deltaTtcCents >= 0 ? "text-success" : "text-danger"
                )}
              >
                {formatDelta(diff.summary.deltaTtcCents)}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2 min-[420px]:col-span-2 lg:col-span-1">
              <dt className="text-xs text-muted-foreground">Totaux</dt>
              <dd className="text-xs text-foreground-secondary">
                {previousVersionLabel} : HT {formatEUR(diff.summary.previousTotals.totalHtCents)} · TTC{" "}
                {formatEUR(diff.summary.previousTotals.totalTtcCents)}
              </dd>
              <dd className="text-xs text-foreground">
                {currentVersionLabel} : HT {formatEUR(diff.summary.currentTotals.totalHtCents)} · TTC{" "}
                {formatEUR(diff.summary.currentTotals.totalTtcCents)}
              </dd>
            </div>
          </dl>
        </section>
      </Card>

      <section className="space-y-3">
        {diff.entries.length === 0 ? (
          <Card className="p-4 text-sm text-foreground-secondary">
            Aucune ligne modifiée. L&apos;écart de total provient des paramètres
            globaux du devis (remise, coefficient global ou arrondi).
          </Card>
        ) : null}
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
