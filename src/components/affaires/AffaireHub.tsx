"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createEstimateVariant,
  duplicateEstimateVersion,
} from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";
import type {
  AffaireHubDpgfSourceResult,
  AffaireHubSummaryResult,
  AffaireHubTimelineResult,
} from "@/lib/affaires/server";
import type { ConfirmUnifiedImportFlowResult } from "@/app/dashboard/affaires/_actions/import-flow";

import { useToast } from "@/components/ui/Toast";
import { AffaireStatusBadges } from "./AffaireStatusBadges";
import { UnifiedImportFlow } from "./UnifiedImportFlow";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AffaireHubProps = {
  summary: AffaireHubSummaryResult;
  timeline: AffaireHubTimelineResult | null;
  dpgfSource: AffaireHubDpgfSourceResult;
  sectionErrors?: {
    timeline?: string;
    dpgfSource?: string;
  };
  justCreated?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Date formatter                                                     */
/* ------------------------------------------------------------------ */

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : DATE_FMT.format(d);
}

/* ------------------------------------------------------------------ */
/*  Status helpers (reused from timeline conventions)                   */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoye",
  accepted: "Accepte",
  archived: "Archive",
};

const STATUS_CSS: Record<string, string> = {
  draft: "status-badge status-draft",
  sent: "status-badge status-sent",
  accepted: "status-badge status-accepted",
  archived: "status-badge status-archived",
};

/* ------------------------------------------------------------------ */
/*  Section: Back to list                                              */
/* ------------------------------------------------------------------ */

function BackToListLink() {
  return (
    <Link
      href="/dashboard/affaires"
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)] hover:text-[var(--slate-900)]"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      Retour a la liste
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Financial Summary                                         */
/* ------------------------------------------------------------------ */

function FinancialSummaryCard({
  summary,
}: {
  summary: AffaireHubSummaryResult;
}) {
  const { currentVersion, acceptedVersion, lineCount } = summary;

  return (
    <section className="dashboard-card p-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--slate-800)]">
        Resume financier
      </h2>

      {currentVersion === null ? (
        <p className="text-sm text-[var(--slate-500)]">
          Aucune version pour cette affaire.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-[var(--slate-500)]">
              HT version courante
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
              {formatEUR(currentVersion.totalHtCents)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
              V{currentVersion.versionNumber} -{" "}
              {STATUS_LABEL[currentVersion.status] ?? currentVersion.status}
            </p>
          </div>

          <div>
            <p className="text-xs text-[var(--slate-500)]">
              HT derniere acceptee
            </p>
            {acceptedVersion ? (
              <>
                <p className="mt-1 text-lg font-semibold text-[var(--success)]">
                  {formatEUR(acceptedVersion.totalHtCents)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                  V{acceptedVersion.versionNumber}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-[var(--slate-400)]">-</p>
            )}
          </div>

          <div>
            <p className="text-xs text-[var(--slate-500)]">
              Marge appliquee
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
              {currentVersion.marginPercent.toFixed(1)}%
            </p>
            <p className="mt-0.5 text-xs text-[var(--slate-500)]">
              Coeff. {currentVersion.marginMultiplier.toFixed(3)}
            </p>
          </div>

          <div>
            <p className="text-xs text-[var(--slate-500)]">Nombre de lignes</p>
            <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
              {lineCount}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Version Timeline                                          */
/* ------------------------------------------------------------------ */

function VersionTimelineCard({
  timeline,
  projectId,
  currentVersionId,
  acceptedVersionId,
  errorMessage,
}: {
  timeline: AffaireHubTimelineResult | null;
  projectId: string;
  currentVersionId: string | null;
  acceptedVersionId: string | null;
  errorMessage?: string;
}) {
  if (timeline === null) {
    return (
      <section className="dashboard-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-[var(--slate-800)]">
          Versions
        </h2>
        <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage ??
            "Impossible de charger la timeline des versions."}
        </div>
      </section>
    );
  }

  const { items, pagination } = timeline;

  return (
    <section className="dashboard-card p-5">
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Versions
        </h2>
        <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]">
          {pagination.total_count} version
          {pagination.total_count !== 1 ? "s" : ""}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" x2="15" y1="13" y2="13" />
              <line x1="9" x2="15" y1="17" y2="17" />
            </svg>
          }
          title="Aucune version encore"
          description="Commencez le chiffrage ou importez un DPGF pour alimenter cette affaire."
          actionLabel="Demarrer"
          actionHref={`/dashboard/estimates/new?projectId=${projectId}`}
          className="py-10"
        />
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div
            aria-hidden="true"
            className="absolute bottom-1 left-[11px] top-1 w-px bg-[var(--slate-200)]"
          />

          <ul className="space-y-3">
            {items.map((version) => {
              const isCurrent = version.id === currentVersionId;
              const isAccepted =
                version.id === acceptedVersionId &&
                version.status === "accepted";

              return (
                <li key={version.id} className="relative pl-8">
                  {/* Dot */}
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-5 h-3 w-3 rounded-full border-2 ${
                      isCurrent
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]"
                        : isAccepted
                          ? "border-[var(--success)] bg-[var(--success)]"
                          : "border-[var(--slate-300)] bg-white"
                    }`}
                  />

                  <Link
                    href={`/dashboard/estimates/${version.id}/edit`}
                    className={`block rounded-xl border px-3 py-3 transition-colors sm:px-4 ${
                      isCurrent
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/5"
                        : "border-[var(--slate-200)] hover:bg-[var(--slate-50)]"
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--slate-800)]">
                            Version {version.version_number}
                          </p>
                          {isCurrent && (
                            <span className="status-badge status-confirmed">
                              Courante
                            </span>
                          )}
                          {isAccepted && (
                            <span className="status-badge status-accepted">
                              Derniere acceptee
                            </span>
                          )}
                        </div>
                        {version.title && (
                          <p
                            className="mt-0.5 truncate text-sm text-[var(--slate-600)]"
                            title={version.title}
                          >
                            {version.title}
                          </p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--slate-500)]">
                          <span className={STATUS_CSS[version.status] ?? "status-badge status-draft"}>
                            {STATUS_LABEL[version.status] ?? version.status}
                          </span>
                          <span>
                            {fmtDate(version.created_at)}
                          </span>
                          {version.author_name && (
                            <span>Par {version.author_name}</span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-left sm:text-right">
                        <p className="text-xs text-[var(--slate-500)]">
                          Total HT
                        </p>
                        <p className="text-sm font-semibold text-[var(--slate-800)]">
                          {formatEUR(version.total_ht_cents)}
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

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--slate-200)] pt-4 text-xs text-[var(--slate-500)]">
          <span>
            Page {pagination.page}/{pagination.total_pages}
          </span>
          <div className="flex gap-2">
            {pagination.has_prev ? (
              <Link
                href={`/dashboard/affaires/${projectId}?timelinePage=${pagination.page - 1}`}
                className="btn btn-secondary btn-sm"
              >
                Prec.
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50">
                Prec.
              </span>
            )}
            {pagination.has_next ? (
              <Link
                href={`/dashboard/affaires/${projectId}?timelinePage=${pagination.page + 1}`}
                className="btn btn-secondary btn-sm"
              >
                Suiv.
              </Link>
            ) : (
              <span className="btn btn-secondary btn-sm opacity-50">
                Suiv.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: DPGF Source                                               */
/* ------------------------------------------------------------------ */

const IMPORT_STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  parsing: "En cours",
  completed: "Termine",
  failed: "Erreur",
};

const MAPPING_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  validated: "Valide",
  applied: "Applique",
  archived: "Archive",
};

function DpgfSourceCard({
  dpgfSource,
  errorMessage,
  onStartImport,
}: {
  dpgfSource: AffaireHubDpgfSourceResult;
  errorMessage?: string;
  onStartImport?: () => void;
}) {
  return (
    <section className="dashboard-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--slate-800)]">
        Source DPGF
      </h2>

      {errorMessage ? (
        <div className="rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage}
        </div>
      ) : dpgfSource === null ? (
        <div className="py-4 text-center">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2 text-[var(--slate-300)]"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="text-sm text-[var(--slate-500)]">
            Aucun import DPGF lie a cette affaire.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3 inline-flex"
            onClick={onStartImport}
          >
            Importer un DPGF
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-sm font-medium text-[var(--slate-800)]"
                title={dpgfSource.filename}
              >
                {dpgfSource.filename}
              </p>
              <p className="mt-0.5 text-xs text-[var(--slate-500)]">
                {dpgfSource.sourceFormat.toUpperCase()} &middot;{" "}
                {dpgfSource.rowCount} lignes &middot; Importe le{" "}
                {fmtDate(dpgfSource.importedAt)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge
              variant={
                dpgfSource.importStatus === "completed" ? "success" : "neutral"
              }
              size="sm"
            >
              Import:{" "}
              {IMPORT_STATUS_LABEL[dpgfSource.importStatus] ??
                dpgfSource.importStatus}
            </Badge>
            {dpgfSource.mappingStatus !== null && (
              <Badge
                variant={
                  dpgfSource.mappingStatus === "validated"
                    ? "success"
                    : "neutral"
                }
                size="sm"
              >
                Mapping:{" "}
                {MAPPING_STATUS_LABEL[dpgfSource.mappingStatus] ??
                  dpgfSource.mappingStatus}
              </Badge>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Section: Quick Actions                                             */
/* ------------------------------------------------------------------ */

function QuickActionsCard({
  summary,
}: {
  summary: AffaireHubSummaryResult;
}) {
  const router = useRouter();
  const { currentVersion, versionsCount, project } = summary;
  const [pendingAction, setPendingAction] = useState<"duplicate" | "variant" | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDuplicate = useCallback(async () => {
    if (!currentVersion || pendingAction) return;
    setActionError(null);
    setPendingAction("duplicate");

    try {
      const duplicatedVersionId = await duplicateEstimateVersion(currentVersion.id);
      router.push(`/dashboard/estimates/${duplicatedVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de dupliquer la version."
      );
    } finally {
      setPendingAction(null);
    }
  }, [currentVersion, pendingAction, router]);

  const handleCreateVariant = useCallback(async () => {
    if (!currentVersion || pendingAction) return;
    setActionError(null);
    setPendingAction("variant");

    try {
      const variantVersionId = await createEstimateVariant(currentVersion.id);
      router.push(`/dashboard/estimates/${variantVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Impossible de creer la variante."
      );
    } finally {
      setPendingAction(null);
    }
  }, [currentVersion, pendingAction, router]);

  return (
    <section className="dashboard-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--slate-800)]">
        Actions rapides
      </h2>

      <div className="flex flex-wrap gap-2">
        {/* Edit current version */}
        {currentVersion && (
          <Link
            href={`/dashboard/estimates/${currentVersion.id}/edit`}
            className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            Editer V{currentVersion.versionNumber}
          </Link>
        )}

        {/* Export */}
        {currentVersion && (
          <Link
            href={`/dashboard/estimates/${currentVersion.id}/print`}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
            Exporter
          </Link>
        )}

        {/* Create new version (duplicate) */}
        {currentVersion && (
          <button
            type="button"
            onClick={() => void handleDuplicate()}
            disabled={pendingAction !== null}
            aria-busy={pendingAction === "duplicate"}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            {pendingAction === "duplicate" ? "Duplication..." : "Nouvelle version"}
          </button>
        )}

        {/* Duplicate (variant) */}
        {currentVersion && (
          <button
            type="button"
            onClick={() => void handleCreateVariant()}
            disabled={pendingAction !== null}
            aria-busy={pendingAction === "variant"}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 3h5v5" />
              <path d="M8 3H3v5" />
              <path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3" />
              <path d="m15 9 6-6" />
            </svg>
            {pendingAction === "variant"
              ? "Creation variante..."
              : "Dupliquer (variante)"}
          </button>
        )}

        {/* Compare - visible only if >1 version */}
        {versionsCount > 1 && currentVersion && (
          <Link
            href={`/dashboard/estimates/${currentVersion.id}/diff`}
            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" x2="18" y1="20" y2="4" />
              <line x1="6" x2="6" y1="20" y2="4" />
              <line x1="2" x2="22" y1="12" y2="12" />
            </svg>
            Comparer
          </Link>
        )}

        {/* Create first version if none exist */}
        {currentVersion === null && (
          <Link
            href={`/dashboard/estimates/new?projectId=${project.id}`}
            className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" x2="12" y1="5" y2="19" />
              <line x1="5" x2="19" y1="12" y2="12" />
            </svg>
            Creer une premiere version
          </Link>
        )}
      </div>

      {actionError ? (
        <div className="alert alert-error mt-3 px-3 py-2 text-xs">
          {actionError}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main AffaireHub component                                          */
/* ------------------------------------------------------------------ */

export function AffaireHub({
  summary,
  timeline,
  dpgfSource,
  sectionErrors,
  justCreated,
}: AffaireHubProps) {
  const router = useRouter();
  const toast = useToast();
  const currentVersionId = summary.currentVersion?.id ?? null;
  const acceptedVersionId = summary.acceptedVersion?.id ?? null;

  useEffect(() => {
    if (justCreated) {
      toast.success({
        title: "Affaire creee",
        description: "Commencez le chiffrage ou importez un DPGF.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once on mount
  }, []);

  const [showImportFlow, setShowImportFlow] = useState(false);
  const [importResult, setImportResult] =
    useState<ConfirmUnifiedImportFlowResult | null>(null);

  const handleImportComplete = useCallback(
    (result: ConfirmUnifiedImportFlowResult) => {
      setShowImportFlow(false);
      setImportResult(result);
      router.refresh();
    },
    [router],
  );

  return (
    <div className="animate-fade-in">
      {/* Back link (always visible, prominent on mobile) */}
      <div className="mb-4">
        <BackToListLink />
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title truncate">{summary.project.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--slate-500)]">
            {summary.project.clientName && (
              <span>{summary.project.clientName}</span>
            )}
            {summary.project.reference && (
              <>
                {summary.project.clientName && (
                  <span className="text-[var(--slate-300)]">&middot;</span>
                )}
                <span>Ref. {summary.project.reference}</span>
              </>
            )}
          </div>
          {summary.currentVersion && (
            <div className="mt-2">
              <AffaireStatusBadges
                currentVersionNumber={summary.currentVersion.versionNumber}
                currentStatus={summary.currentVersion.status}
                acceptedVersionNumber={
                  summary.acceptedVersion?.versionNumber ?? null
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Import result summary banner */}
      {importResult && (
        <div className="mb-4 animate-fade-in rounded-xl border border-[var(--success)]/20 bg-[var(--success)]/5 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--success)]/10">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--success)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--slate-800)]">
                  Import termine
                </p>
                <p className="mt-0.5 text-xs text-[var(--slate-600)]">
                  {importResult.stats.insertedRows} ligne
                  {importResult.stats.insertedRows > 1 ? "s" : ""} inseree
                  {importResult.stats.insertedRows > 1 ? "s" : ""}
                  {importResult.stats.skippedRows > 0 && (
                    <>
                      {" — "}
                      {importResult.stats.skippedRows} ignoree
                      {importResult.stats.skippedRows > 1 ? "s" : ""}
                    </>
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-[var(--slate-400)] hover:text-[var(--slate-600)]"
              onClick={() => setImportResult(null)}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Unified Import Flow (full-width, replaces grid when active) */}
      {showImportFlow ? (
        <UnifiedImportFlow
          projectId={summary.project.id}
          onCancel={() => setShowImportFlow(false)}
          onComplete={handleImportComplete}
        />
      ) : (
        /* Content: 2 columns on desktop, stacked on mobile */
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left column: Financial + Timeline */}
          <div className="space-y-4 lg:col-span-2">
            <FinancialSummaryCard summary={summary} />
            <VersionTimelineCard
              timeline={timeline}
              projectId={summary.project.id}
              currentVersionId={currentVersionId}
              acceptedVersionId={acceptedVersionId}
              errorMessage={sectionErrors?.timeline}
            />
          </div>

          {/* Right column: DPGF + Quick Actions */}
          <div className="space-y-4">
            <DpgfSourceCard
              dpgfSource={dpgfSource}
              errorMessage={sectionErrors?.dpgfSource}
              onStartImport={() => {
                setImportResult(null);
                setShowImportFlow(true);
              }}
            />
            <QuickActionsCard summary={summary} />
          </div>
        </div>
      )}
    </div>
  );
}
