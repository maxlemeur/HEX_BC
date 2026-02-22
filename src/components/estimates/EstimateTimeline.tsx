import Link from "next/link";

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
      return "Envoye";
    case "accepted":
      return "Accepte";
    case "archived":
      return "Archive";
    case "canceled":
      return "Annule";
    default:
      return "Inconnu";
  }
}

function statusClass(status: EstimateTimelineStatus) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "accepted":
      return "status-badge status-accepted";
    case "archived":
    case "canceled":
      return "status-badge status-archived";
    default:
      return "status-badge status-draft";
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

export function EstimateTimeline({
  currentVersionId,
  versions,
  pagination,
}: Readonly<EstimateTimelineProps>) {
  const visibleStart =
    pagination.total_count === 0 ? 0 : (pagination.page - 1) * pagination.page_size + 1;
  const visibleEnd = Math.min(
    pagination.total_count,
    pagination.page * pagination.page_size
  );

  return (
    <aside className="dashboard-card h-fit p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Historique versions
          </h2>
          <p className="text-xs text-[var(--slate-500)]">
            {pagination.total_count} version{pagination.total_count > 1 ? "s" : ""}
          </p>
        </div>
        <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs font-semibold text-[var(--slate-600)]">
          Page {pagination.page}/{pagination.total_pages}
        </span>
      </div>

      {versions.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--slate-500)]">
          Aucun historique disponible.
        </p>
      ) : (
        <div className="relative mt-4">
          <div
            aria-hidden="true"
            className="absolute bottom-1 left-[11px] top-1 w-px bg-[var(--slate-200)]"
          />
          <ul className="space-y-3">
            {versions.map((version) => {
              const status = version.status as EstimateTimelineStatus;
              const isCurrent = version.id === currentVersionId;
              const isCanceled = isCanceledStatus(status);

              return (
                <li key={version.id} className="relative pl-8">
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-5 h-3 w-3 rounded-full border-2 ${
                      isCurrent
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]"
                        : "border-[var(--slate-300)] bg-white"
                    }`}
                  />
                  <Link
                    aria-current={isCurrent ? "page" : undefined}
                    className={`block rounded-xl border px-3 py-3 transition-colors sm:px-4 ${
                      isCurrent
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
                        : "border-[var(--slate-200)] hover:bg-[var(--slate-50)]"
                    } ${isCanceled ? "opacity-70 grayscale" : ""}`}
                    href={buildVersionHref(version.id, pagination.page)}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--slate-800)]">
                            Version {version.version_number}
                          </p>
                          {isCurrent ? (
                            <span className="status-badge status-confirmed">
                              Courante
                            </span>
                          ) : null}
                        </div>
                        {version.title ? (
                          <p
                            className="mt-1 truncate text-sm text-[var(--slate-600)]"
                            title={version.title}
                          >
                            {version.title}
                          </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--slate-500)]">
                          <span className={statusClass(status)}>
                            {statusLabel(status)}
                          </span>
                          <span>Cree le {formatDate(version.created_at)}</span>
                          <span>
                            {version.author_name
                              ? `Par ${version.author_name}`
                              : "Auteur inconnu"}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-left sm:text-right">
                        <p className="text-xs text-[var(--slate-500)]">Total TTC</p>
                        <p className="text-sm font-semibold text-[var(--slate-800)]">
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
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--slate-200)] pt-4">
          <p className="text-xs text-[var(--slate-500)]">
            {visibleStart}-{visibleEnd} sur {pagination.total_count}
          </p>
          <div className="flex items-center gap-2">
            {pagination.has_prev ? (
              <Link
                className="btn btn-secondary btn-sm"
                href={buildVersionHref(currentVersionId, pagination.page - 1)}
              >
                Prev
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50">Prev</span>
            )}
            {pagination.has_next ? (
              <Link
                className="btn btn-secondary btn-sm"
                href={buildVersionHref(currentVersionId, pagination.page + 1)}
              >
                Next
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50">Next</span>
            )}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
