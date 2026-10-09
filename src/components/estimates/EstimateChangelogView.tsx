import { ChevronDownIcon, FileDownIcon } from "lucide-react";

import { EstimateExplanationTrigger } from "@/components/estimates/EstimateExplanationTrigger";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  EstimateVersionChangelog,
  EstimateVersionChangelogChange,
  EstimateVersionChangelogField,
} from "@/lib/estimates/changelog";

type EstimateChangelogViewProps = {
  versionId: string;
  compareVersionId: string;
  changelog: EstimateVersionChangelog;
  previousVersionLabel: string;
  currentVersionLabel: string;
  exportPdfHref: string | null;
};

const NUMBER_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 3,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
});

function formatDelta(cents: number) {
  const prefix = cents > 0 ? "+" : "";
  return `${prefix}${formatEUR(cents)}`;
}

function formatFieldValue(
  field: EstimateVersionChangelogField,
  value: string | number | null
) {
  if (value === null) return "-";

  if (field.kind === "money") {
    if (typeof value !== "number") return value;
    return formatEUR(value);
  }

  if (field.kind === "percent") {
    if (typeof value !== "number") return value;
    return `${PERCENT_FORMATTER.format(value / 100)}%`;
  }

  if (field.kind === "number") {
    if (typeof value !== "number") return value;
    return NUMBER_FORMATTER.format(value);
  }

  return String(value);
}

function changeTypeLabel(changeType: EstimateVersionChangelogChange["changeType"]) {
  if (changeType === "added") return "Ajout";
  if (changeType === "removed") return "Suppression";
  return "Modification";
}

function changeTypeBadgeVariant(
  changeType: EstimateVersionChangelogChange["changeType"]
): BadgeProps["variant"] {
  if (changeType === "added") return "success";
  if (changeType === "removed") return "danger";
  return "warning";
}

function deltaToneClass(cents: number) {
  return cents >= 0 ? "text-success" : "text-danger";
}

function ExportPdfLink({ href }: { href: string }) {
  return (
    <a
      className={buttonVariants({ variant: "outline", size: "sm" })}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      <FileDownIcon aria-hidden="true" />
      Exporter le journal (PDF)
      <span className="sr-only"> (nouvel onglet)</span>
    </a>
  );
}

function entityTypeLabel(entityType: EstimateVersionChangelogChange["entityType"]) {
  if (entityType === "section") return "Section";
  return "Ligne";
}

export function EstimateChangelogView({
  versionId,
  compareVersionId,
  changelog,
  previousVersionLabel,
  currentVersionLabel,
  exportPdfHref,
}: Readonly<EstimateChangelogViewProps>) {
  if (changelog.summary.totalChangeCount === 0) {
    return (
      <EmptyState
        title="Aucun changement détecté"
        description="Les deux versions sélectionnées ont le même contenu et les mêmes totaux."
        headingLevel={2}
        action={exportPdfHref ? <ExportPdfLink href={exportPdfHref} /> : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <section aria-labelledby="estimate-changelog-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="estimate-changelog-title" className="text-sm font-semibold text-foreground">
                Journal des modifications
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Regroupé par section, avec les écarts HT/TTC et les valeurs avant/après.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <EstimateExplanationTrigger
                kind="delta"
                versionId={versionId}
                compareVersionId={compareVersionId}
                currentVersionLabel={currentVersionLabel}
                compareVersionLabel={previousVersionLabel}
                triggerLabel="Expliquer l’écart"
                surfaceLabel="Explication de l’écart entre versions"
              />
              {exportPdfHref ? <ExportPdfLink href={exportPdfHref} /> : null}
            </div>
          </div>

          <dl className="mt-3 grid gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Ajouts</dt>
              <dd className="text-lg font-semibold tabular-nums text-success">
                {changelog.summary.addedCount}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Suppressions</dt>
              <dd className="text-lg font-semibold tabular-nums text-danger">
                {changelog.summary.removedCount}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Modifications</dt>
              <dd className="text-lg font-semibold tabular-nums text-warning">
                {changelog.summary.modifiedCount}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Écart HT total</dt>
              <dd className={cn("text-lg font-semibold tabular-nums", deltaToneClass(changelog.summary.deltaHtCents))}>
                {formatDelta(changelog.summary.deltaHtCents)}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Écart TTC total</dt>
              <dd className={cn("text-lg font-semibold tabular-nums", deltaToneClass(changelog.summary.deltaTtcCents))}>
                {formatDelta(changelog.summary.deltaTtcCents)}
              </dd>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <dt className="text-xs text-muted-foreground">Changements</dt>
              <dd className="text-lg font-semibold tabular-nums text-foreground">
                {changelog.summary.totalChangeCount}
              </dd>
            </div>
          </dl>
        </section>
      </Card>

      {changelog.sections.map((section, sectionIndex) => (
        <details
          key={section.key}
          className="group min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
          open={sectionIndex === 0}
        >
          <summary className="cursor-pointer list-none border-b border-border-subtle px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <ChevronDownIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0 motion-reduce:transition-none"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Section
                  </p>
                  <p className="break-words text-sm font-semibold text-foreground">{section.label}</p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-right text-xs">
                <div>
                  <dt className="text-muted-foreground">Écart HT</dt>
                  <dd className={cn("font-semibold tabular-nums", deltaToneClass(section.deltaHtCents))}>
                    {formatDelta(section.deltaHtCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Écart TTC</dt>
                  <dd className={cn("font-semibold tabular-nums", deltaToneClass(section.deltaTtcCents))}>
                    {formatDelta(section.deltaTtcCents)}
                  </dd>
                </div>
              </dl>
            </div>
          </summary>

          <div className="space-y-4 p-4">
            {section.changes.map((change) => (
              <article
                key={change.key}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={changeTypeBadgeVariant(change.changeType)} size="sm">
                        {changeTypeLabel(change.changeType)}
                      </Badge>
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {entityTypeLabel(change.entityType)}
                      </span>
                    </div>
                    <h3 className="break-words text-sm font-semibold text-foreground">
                      {change.designation}
                    </h3>
                  </div>

                  <div className="flex items-center gap-3 text-xs">
                    <span className={cn("font-semibold tabular-nums", deltaToneClass(change.deltaHtCents))}>
                      HT {formatDelta(change.deltaHtCents)}
                    </span>
                    <span className={cn("font-semibold tabular-nums", deltaToneClass(change.deltaTtcCents))}>
                      TTC {formatDelta(change.deltaTtcCents)}
                    </span>
                  </div>
                </header>

                {change.fields.length > 0 ? (
                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    <table className="data-table w-full [&_td]:break-words">
                      <thead>
                        <tr>
                          <th scope="col">Champ</th>
                          <th scope="col">{previousVersionLabel}</th>
                          <th scope="col">{currentVersionLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {change.fields.map((field) => (
                          <tr key={`${change.key}:${field.field}`}>
                            <td className="font-medium">{field.label}</td>
                            <td className="text-muted-foreground">
                              {formatFieldValue(field, field.beforeValue)}
                            </td>
                            <td className="font-semibold text-foreground">
                              {formatFieldValue(field, field.afterValue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Aucun détail de champ disponible.
                  </p>
                )}
              </article>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
