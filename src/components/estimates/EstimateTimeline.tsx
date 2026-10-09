import Link from "next/link";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatEUR } from "@/lib/money";
import type {
  EstimateProjectVersionTimelineItem,
  ListEstimateProjectVersionsResult,
} from "@/lib/estimates/server";

type EstimateTimelineStatus = EstimateProjectVersionTimelineItem["status"] | "canceled";

type EstimateTimelineProps = {
  currentVersionId: string;
  versions: EstimateProjectVersionTimelineItem[];
  pagination: ListEstimateProjectVersionsResult["pagination"];
};

const TIMELINE_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function statusLabel(status: EstimateTimelineStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyé";
    case "accepted":
      return "Accepté";
    case "archived":
      return "Archivé";
    case "canceled":
      return "Annulé";
    default:
      return "Inconnu";
  }
}

function statusVariant(status: EstimateTimelineStatus): BadgeProps["variant"] {
  switch (status) {
    case "sent":
      return "info";
    case "accepted":
      return "success";
    case "archived":
    case "canceled":
      return "outline";
    default:
      return "neutral";
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return TIMELINE_DATE_FORMATTER.format(date);
}

function buildVersionHref(versionId: string, page: number) {
  if (page > 1) {
    return `/dashboard/estimates/${versionId}?historyPage=${page}`;
  }
  return `/dashboard/estimates/${versionId}`;
}

function isCanceledStatus(status: EstimateTimelineStatus) {
  return status === "canceled";
}

const pagerButtonClass = buttonVariants({ variant: "outline", size: "sm" });

export function EstimateTimeline({
  currentVersionId,
  versions,
  pagination,
}: Readonly<EstimateTimelineProps>) {
  const versionNumberById = new Map(
    versions.map((version) => [version.id, version.version_number])
  );
  const visibleStart =
    pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const visibleEnd = Math.min(
    pagination.total_count,
    pagination.page * pagination.page_size
  );

  return (
    <Card className="h-fit p-4 sm:p-5">
      <section aria-labelledby="estimate-timeline-title">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="estimate-timeline-title" className="text-sm font-semibold text-foreground">
              Historique des versions
            </h2>
            <p className="text-xs text-muted-foreground">
              {pagination.total_count} version{pagination.total_count > 1 ? "s" : ""}
            </p>
          </div>
          {pagination.total_pages > 1 ? (
            <Badge variant="neutral">
              Page {pagination.page}/{pagination.total_pages}
            </Badge>
          ) : null}
        </div>

        {versions.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Aucun historique disponible.
          </p>
        ) : (
          <div className="relative mt-4">
            <div
              aria-hidden="true"
              className="absolute bottom-1 left-[11px] top-1 w-px bg-border"
            />
            <ul className="space-y-3">
              {versions.map((version, index) => {
                const status = version.status as EstimateTimelineStatus;
                const isCurrent = version.id === currentVersionId;
                const isCanceled = isCanceledStatus(status);
                const variantLabel = version.variant_label?.trim() ?? null;
                const parentVersionId = version.parent_version_id;
                const isVariant = Boolean(parentVersionId && variantLabel);
                const parentVersionNumber = parentVersionId
                  ? (versionNumberById.get(parentVersionId) ?? null)
                  : null;
                const previousVersion = versions[index + 1];
                const delta = previousVersion
                  ? version.total_ht_cents - previousVersion.total_ht_cents
                  : 0;

                return (
                  <li
                    key={version.id}
                    className={cn("relative", isVariant ? "pl-14" : "pl-8")}
                  >
                    {isVariant ? (
                      <span
                        aria-hidden="true"
                        className="absolute left-[11px] top-6 h-px w-5 bg-border-strong"
                      />
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-5 size-3 rounded-full border-2",
                        isVariant ? "left-5" : "left-0",
                        isCurrent ? "border-primary bg-primary" : "border-border-strong bg-surface"
                      )}
                    />
                    <Link
                      aria-current={isCurrent ? "page" : undefined}
                      className={cn(
                        "block rounded-lg border px-3 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4",
                        isCurrent ? "border-primary bg-primary/5" : "border-border hover:bg-surface-subtle",
                        isCanceled && "opacity-70 grayscale"
                      )}
                      href={buildVersionHref(version.id, pagination.page)}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">
                              {isVariant
                                ? `Variante ${variantLabel} · V${version.version_number}`
                                : `Version ${version.version_number}`}
                            </p>
                            {isVariant ? (
                              <Badge variant="outline" size="sm">Branche</Badge>
                            ) : null}
                            {isCurrent ? (
                              <Badge variant="brand" size="sm">Courante</Badge>
                            ) : null}
                          </div>
                          {version.title ? (
                            <p
                              className="mt-1 truncate text-sm text-foreground-secondary"
                              title={version.title}
                            >
                              {version.title}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <Badge variant={statusVariant(status)} size="sm" dot>
                              {statusLabel(status)}
                            </Badge>
                            {isVariant ? (
                              <span>
                                {parentVersionNumber
                                  ? `Issue de V${parentVersionNumber}`
                                  : "Issue d'une version parente"}
                              </span>
                            ) : null}
                            <span>Créée le {formatDate(version.created_at)}</span>
                            <span>
                              {version.author_name
                                ? `Par ${version.author_name}`
                                : "Auteur inconnu"}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-left sm:text-right">
                          <p className="text-xs text-muted-foreground">Total HT</p>
                          <div className="flex items-center gap-1.5 sm:justify-end">
                            <p className="text-sm font-semibold tabular-nums text-foreground">
                              {formatEUR(version.total_ht_cents)}
                            </p>
                            {delta !== 0 ? (
                              <span
                                className={cn(
                                  "text-xs font-medium tabular-nums",
                                  delta > 0 ? "text-success" : "text-danger"
                                )}
                              >
                                {delta > 0 ? "+" : ""}
                                {formatEUR(delta)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">Total TTC</p>
                          <p className="text-sm font-semibold tabular-nums text-foreground">
                            {formatEUR(version.total_ttc_cents)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {pagination.total_count > pagination.page_size ? (
          <nav
            aria-label="Pages de l'historique"
            className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4"
          >
            <p className="text-xs text-muted-foreground">
              {visibleStart}–{visibleEnd} sur {pagination.total_count}
            </p>
            <div className="flex items-center gap-2">
              {pagination.has_prev ? (
                <Link
                  className={pagerButtonClass}
                  href={buildVersionHref(currentVersionId, pagination.page - 1)}
                >
                  Précédent
                </Link>
              ) : (
                <span aria-disabled="true" className={pagerButtonClass}>
                  Précédent
                </span>
              )}
              {pagination.has_next ? (
                <Link
                  className={pagerButtonClass}
                  href={buildVersionHref(currentVersionId, pagination.page + 1)}
                >
                  Suivant
                </Link>
              ) : (
                <span aria-disabled="true" className={pagerButtonClass}>
                  Suivant
                </span>
              )}
            </div>
          </nav>
        ) : null}
      </section>
    </Card>
  );
}
