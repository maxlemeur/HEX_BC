"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import {
  duplicateEstimateVersion,
  fetchEstimateList,
  type EstimateListItem,
  type EstimateStatus,
} from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";

const PAGE_SIZE = 8;

function statusLabel(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoye";
    case "accepted":
      return "Accepte";
    case "archived":
      return "Archive";
    default:
      return status;
  }
}

function statusClass(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "accepted":
      return "status-badge status-accepted";
    case "archived":
      return "status-badge status-archived";
    default:
      return "status-badge status-draft";
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export default function EstimatesPage() {
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchEstimates = useCallback(async () => fetchEstimateList(), []);

  const {
    data: estimates = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<EstimateListItem[]>("estimate-list", fetchEstimates, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const totalPages = Math.max(1, Math.ceil(estimates.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedEstimates = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return estimates.slice(start, start + PAGE_SIZE);
  }, [currentPage, estimates]);

  const handleDuplicate = useCallback(
    async (versionId: string) => {
      if (duplicatingId) return;
      setActionError(null);
      setDuplicatingId(versionId);

      try {
        const duplicatedVersionId = await duplicateEstimateVersion(versionId);
        router.push(`/dashboard/estimates/${duplicatedVersionId}/edit`);
        router.refresh();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Une erreur est survenue."
        );
      } finally {
        setDuplicatingId(null);
      }
    },
    [duplicatingId, router]
  );

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Chiffrages</h1>
          <p className="page-description">
            Suivez et preparez vos chiffrages par projet.
          </p>
        </div>
        <Link className="btn btn-primary btn-lg" href="/dashboard/estimates/new">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Nouveau chiffrage
        </Link>
      </div>

      {actionError ? (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {actionError}
        </div>
      ) : null}

      <div className="dashboard-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">
              Liste des chiffrages
            </h2>
            <p className="text-xs text-[var(--slate-500)]">
              Derniere version active par projet.
            </p>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={isValidating}
            onClick={() => void mutate()}
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={isValidating ? "animate-spin" : ""}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            {isValidating ? "Chargement..." : "Actualiser"}
          </button>
        </div>

        {loadError ? (
          <div className="alert alert-error m-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
            {loadError.message}
          </div>
        ) : null}

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Titre</th>
                <th>Version</th>
                <th>Statut</th>
                <th className="text-right">Total HT vente</th>
                <th>MAJ</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEstimates.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                        <span className="text-[var(--slate-500)]">
                          Chargement...
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--slate-400)"
                            strokeWidth="1.5"
                          >
                            <rect x="3" y="4" width="18" height="16" rx="2" />
                            <path d="M7 8h10" />
                            <path d="M7 12h4" />
                            <path d="M13 12h4" />
                            <path d="M7 16h4" />
                            <path d="M13 16h4" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-medium text-[var(--slate-700)]">
                            Aucun chiffrage
                          </p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">
                            Creez votre premier chiffrage pour demarrer.
                          </p>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedEstimates.map((estimate, index) => {
                  const isDuplicating = duplicatingId === estimate.versionId;
                  const title = estimate.title?.trim() || "Sans titre";
                  const projectMeta =
                    estimate.projectReference?.trim() ||
                    estimate.projectClient?.trim();

                  return (
                    <tr
                      key={estimate.versionId}
                      className="animate-fade-in"
                      style={{ animationDelay: `${index * 0.03}s` }}
                    >
                      <td>
                        <div className="flex flex-col">
                          <span className="font-semibold text-[var(--slate-800)]">
                            {estimate.projectName}
                          </span>
                          {projectMeta ? (
                            <span className="text-xs text-[var(--slate-500)]">
                              {projectMeta}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-[var(--slate-600)]">{title}</td>
                      <td>
                        <Link
                          href={`/dashboard/estimates/${estimate.versionId}`}
                          className="inline-flex items-center rounded-md bg-[var(--slate-100)] px-2 py-1 font-mono text-xs font-medium text-[var(--slate-600)]"
                        >
                          V{estimate.versionNumber}
                        </Link>
                      </td>
                      <td>
                        <span className={statusClass(estimate.status)}>
                          {statusLabel(estimate.status)}
                        </span>
                      </td>
                      <td className="text-right font-mono font-semibold text-[var(--slate-800)]">
                        {formatEUR(estimate.totalHtCents)}
                      </td>
                      <td className="text-sm text-[var(--slate-500)]">
                        {formatDate(estimate.updatedAt)}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/estimates/${estimate.versionId}`}
                            className="btn btn-secondary btn-sm"
                          >
                            Ouvrir
                          </Link>
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            onClick={() => void handleDuplicate(estimate.versionId)}
                            disabled={Boolean(duplicatingId)}
                          >
                            {isDuplicating ? (
                              <>
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--slate-600)]"></span>
                                Duplication...
                              </>
                            ) : (
                              "Dupliquer"
                            )}
                          </button>
                          <Link
                            href={`/dashboard/estimates/${estimate.versionId}/print`}
                            className="btn btn-ghost btn-sm"
                          >
                            Print
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {estimates.length > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-[var(--slate-200)] px-6 py-4">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Precedent
            </button>
            <span className="text-xs text-[var(--slate-500)]">
              Page {currentPage} / {totalPages}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={currentPage === totalPages}
            >
              Suivant
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
