"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { AffaireStatusBadges } from "./AffaireStatusBadges";
import { AffaireFavoriteButton } from "./AffaireFavoriteButton";
import { useDeleteAffaire } from "./useDeleteAffaire";
import {
  fetchAffaireDenseExpandData,
  type AffaireDenseExpandData,
} from "@/app/dashboard/affaires/_actions/dense-table-expand";
import type {
  AffaireListItem,
  AffaireManagerQueueFilter,
  AffaireManagerQueueSummary,
} from "./types";

const APPROVAL_BADGE: Record<string, { label: string; className: string }> = {
  required: { label: "À valider", className: "bg-amber-50 text-amber-900 border-amber-200" },
  in_review: { label: "En revue", className: "bg-blue-50 text-blue-800 border-blue-200" },
  approved: { label: "Approuvée", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  changes_requested: { label: "À reprendre", className: "bg-red-50 text-red-800 border-red-200" },
};

type AffairesEmptyVariant = "no-data" | "filtered";

type Props = {
  items: AffaireListItem[];
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
  onToggleFavorite: (projectId: string, nextIsFavorite: boolean) => void;
  favoritePendingIds: string[];
  managerFilter: AffaireManagerQueueFilter;
  onManagerFilterChange: (nextFilter: AffaireManagerQueueFilter) => void;
  managerQueueSummary: AffaireManagerQueueSummary | null;
  managerQueueSummaryState:
    | "idle"
    | "loading"
    | "ready"
    | "error"
    | "unavailable";
  selectedProjectIds?: string[];
  onToggleProjectSelection?: (projectId: string) => void;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAmount(cents: number): string {
  const currency = normalizeEstimateCurrency("EUR") ?? "EUR";
  return formatCurrency(cents, currency);
}

function formatManagerQueueCount(count: number, label: string): string {
  return `${count} affaire${count > 1 ? "s" : ""} ${label}`;
}

function AffairesEmptyState({
  emptyVariant,
  onCreateAffaire,
}: {
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
}) {
  return (
    <tr>
      <td colSpan={11} className="py-16 text-center">
        {emptyVariant === "no-data" ? (
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
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            }
            title="Créez votre première affaire"
            description="Démarrez un nouveau projet pour lancer votre premier chiffrage."
            actionLabel="Nouvelle affaire"
            onAction={onCreateAffaire}
            className="mx-auto max-w-xl"
          />
        ) : (
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
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            }
            title="Aucune affaire trouvée"
            description="Modifiez vos filtres ou votre recherche pour afficher des résultats."
            className="mx-auto max-w-xl"
          />
        )}
      </td>
    </tr>
  );
}

function versionStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyé";
    case "accepted":
      return "Accepté";
    case "archived":
      return "Archivé";
    default:
      return status;
  }
}

function importStatusBadge(status: string) {
  switch (status) {
    case "done":
      return { label: "Importé", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "running":
      return { label: "En cours", className: "bg-blue-50 text-blue-700 border-blue-200" };
    case "failed":
      return { label: "Échec", className: "bg-red-50 text-red-700 border-red-200" };
    default:
      return { label: status, className: "bg-gray-50 text-gray-600 border-gray-200" };
  }
}

function mappingStatusBadge(status: string | null) {
  if (!status) return null;
  switch (status) {
    case "mapped":
      return { label: "Mappé", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "partial":
      return { label: "Partiel", className: "bg-amber-50 text-amber-700 border-amber-200" };
    case "unmapped":
      return { label: "Non mappe", className: "bg-gray-50 text-gray-600 border-gray-200" };
    default:
      return { label: status, className: "bg-gray-50 text-gray-600 border-gray-200" };
  }
}

export function AffairesDenseTable({
  items,
  emptyVariant,
  onCreateAffaire,
  onToggleFavorite,
  favoritePendingIds,
  managerFilter,
  onManagerFilterChange,
  managerQueueSummary,
  managerQueueSummaryState,
  selectedProjectIds = [],
  onToggleProjectSelection,
}: Readonly<Props>) {
  const router = useRouter();
  const { requestDelete, modalProps } = useDeleteAffaire();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandCache, setExpandCache] = useState<
    Record<string, AffaireDenseExpandData | "loading" | "error">
  >({});
  const expandCacheRef = useRef(expandCache);

  useEffect(() => {
    expandCacheRef.current = expandCache;
  }, [expandCache]);

  const ensureExpandData = useCallback((projectId: string) => {
    const cached = expandCacheRef.current[projectId];
    if (cached && cached !== "error") {
      return;
    }

    setExpandCache((current) => {
      if (current[projectId] && current[projectId] !== "error") {
        return current;
      }

      return { ...current, [projectId]: "loading" };
    });

    fetchAffaireDenseExpandData(projectId)
      .then((data) =>
        setExpandCache((current) => ({ ...current, [projectId]: data }))
      )
      .catch(() =>
        setExpandCache((current) => ({ ...current, [projectId]: "error" }))
      );
  }, []);

  // Only consider expanded IDs that are in the current items (auto-reset on pagination/filter)
  const currentItemIds = useMemo(() => new Set(items.map((i) => i.projectId)), [items]);
  const isExpanded = useCallback(
    (id: string) => expandedIds.has(id) && currentItemIds.has(id),
    [expandedIds, currentItemIds]
  );

  const handleToggleExpand = useCallback(
    (projectId: string) => {
      const shouldLoadExpandData = !expandedIds.has(projectId);

      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(projectId)) {
          next.delete(projectId);
        } else {
          next.add(projectId);
        }
        return next;
      });

      if (shouldLoadExpandData) {
        ensureExpandData(projectId);
      }
    },
    [ensureExpandData, expandedIds]
  );

  const managerCounts = managerQueueSummary?.counts ?? {
    followUp: 0,
    reservations: 0,
    revalidation: 0,
  };
  const managerQualificationIncomplete = (managerQueueSummary?.incompleteCount ?? 0) > 0;
  const managerFilterDisabled =
    managerQueueSummaryState !== "ready" || managerQualificationIncomplete;

  return (
    <div className="dashboard-card overflow-hidden">
      <ConfirmModal {...modalProps} />
      <div className="border-b border-[var(--slate-200)] bg-[var(--slate-50)]/70 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--slate-800)]">
              Relances manager
            </p>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Repère les affaires visibles à relancer en priorité, à revoir sous réserves ou à rouvrir en revalidation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`min-h-11 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
                managerFilter === "all"
                  ? "bg-[var(--slate-900)] text-white"
                  : "border border-[var(--slate-200)] bg-white text-[var(--slate-600)] hover:border-[var(--slate-300)]"
              }`}
              onClick={() => onManagerFilterChange("all")}
            >
              Toutes
            </button>
            <button
              type="button"
              className={`min-h-11 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
                managerFilter === "follow_up"
                  ? "bg-[var(--danger)] text-white"
                  : "border border-[var(--danger)]/20 bg-[var(--danger)]/5 text-[var(--danger)] hover:bg-[var(--danger)]/10"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={managerFilterDisabled}
              onClick={() => onManagerFilterChange("follow_up")}
            >
              À relancer en priorité ({managerCounts.followUp})
            </button>
            <button
              type="button"
              className={`min-h-11 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
                managerFilter === "reservations"
                  ? "bg-[var(--warning)] text-white"
                  : "border border-[var(--warning)]/20 bg-[var(--warning)]/5 text-[var(--warning)] hover:bg-[var(--warning)]/10"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={managerFilterDisabled}
              onClick={() => onManagerFilterChange("reservations")}
            >
              À revoir sous réserves ({managerCounts.reservations})
            </button>
            <button
              type="button"
              className={`min-h-11 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
                managerFilter === "revalidation"
                  ? "bg-[var(--brand-blue-dark)] text-white"
                  : "border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/10 text-[var(--brand-blue-dark)] hover:bg-[var(--brand-blue)]/15"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={managerFilterDisabled}
              onClick={() => onManagerFilterChange("revalidation")}
            >
              À rouvrir en revalidation ({managerCounts.revalidation})
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--slate-500)]">
          {managerQueueSummaryState === "loading" || managerQueueSummaryState === "idle"
            ? "Qualification manager en cours sur le portefeuille."
            : managerQueueSummaryState === "unavailable"
              ? "Qualification indisponible pour ce volume, affinez les filtres."
            : managerQueueSummaryState === "error"
              ? "Qualification manager indisponible pour ce portefeuille. Affinez les filtres ou rechargez la page pour réessayer."
              : managerQualificationIncomplete
                ? `Qualification manager incomplète sur ${managerQueueSummary?.incompleteCount ?? 0} affaire${(managerQueueSummary?.incompleteCount ?? 0) > 1 ? "s" : ""} du portefeuille.`
            : managerFilter === "all"
              ? `${formatManagerQueueCount(managerCounts.followUp, "à relancer en priorité")}, ${formatManagerQueueCount(managerCounts.reservations, "à revoir sous réserves")} et ${formatManagerQueueCount(managerCounts.revalidation, "à rouvrir en revalidation")} dans le portefeuille.`
            : managerFilter === "reservations"
              ? `${formatManagerQueueCount(managerCounts.reservations, "à revoir sous réserves")} dans le portefeuille.`
              : managerFilter === "revalidation"
                ? `${formatManagerQueueCount(managerCounts.revalidation, "à rouvrir en revalidation")} dans le portefeuille.`
                : `${formatManagerQueueCount(managerCounts.followUp, "à relancer en priorité")} dans le portefeuille.`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Liste des affaires et de leur dernière version de chiffrage
          </caption>
          <thead>
            <tr className="border-b border-[var(--slate-200)] bg-[var(--slate-50)]">
              <th scope="col" className="w-10">
                <span className="sr-only">Détails</span>
              </th>
              <th scope="col" className="w-10">
                <span className="sr-only">Sélection</span>
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Nom affaire
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Client
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Ref.
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Statut courant
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider"
                title="Dernière version acceptée par le client, conservée comme référence commerciale."
              >
                Version acceptée
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-center text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider"
                title="État de l’approbation interne requise avant l’envoi au client."
              >
                Approbation
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Total HT
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Date MAJ
              </th>
              <th scope="col" className="w-28">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <AffairesEmptyState
                emptyVariant={emptyVariant}
                onCreateAffaire={onCreateAffaire}
              />
            ) : (
              items.map((item) => {
                const hasCurrentVersion =
                  item.hasCurrentVersion &&
                  item.currentVersionId !== null &&
                  item.currentVersionNumber !== null &&
                  item.currentStatus !== null;
                const canSelect =
                  !hasCurrentVersion || item.currentStatus === "draft";

                const primaryHref = `/dashboard/affaires/${item.projectId}`;
                const expanded = isExpanded(item.projectId);
                const cached = expandCache[item.projectId];

                return (
                  <Fragment key={item.projectId}>
                  <tr
                    className="border-b border-[var(--slate-100)] cursor-pointer hover:bg-[var(--slate-50)] transition-colors"
                    onClick={() => router.push(primaryHref)}
                  >
                    <td>
                      <button
                        type="button"
                        className={`expand-button ${expanded ? "expanded" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleExpand(item.projectId);
                        }}
                        aria-expanded={expanded}
                        aria-label={expanded ? "Replier" : "Déplier"}
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
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                    </td>
                    <td
                      className="px-2 py-3 text-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {canSelect && onToggleProjectSelection ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-[var(--slate-300)] text-[var(--brand-blue)]"
                          checked={selectedProjectIds.includes(item.projectId)}
                          aria-label={`Selectionner l'affaire ${item.projectName}`}
                          onChange={() =>
                            onToggleProjectSelection(item.projectId)
                          }
                        />
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--slate-900)] max-w-[200px] truncate">
                      {item.projectName}
                    </td>
                    <td className="px-4 py-3 text-[var(--slate-600)] max-w-[160px] truncate">
                      {item.projectClient ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-[var(--slate-400)] max-w-[120px] truncate">
                      {item.projectReference ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {hasCurrentVersion ? (
                        <AffaireStatusBadges
                          currentVersionNumber={item.currentVersionNumber!}
                          currentStatus={item.currentStatus!}
                          acceptedVersionNumber={null}
                        />
                      ) : (
                        <span className="text-xs font-medium text-[var(--slate-500)]">
                          Aucun chiffrage
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.acceptedVersionNumber !== null ? (
                        <AffaireStatusBadges
                          currentVersionNumber={item.acceptedVersionNumber}
                          currentStatus="accepted"
                          acceptedVersionNumber={null}
                        />
                      ) : (
                        <span className="text-xs text-[var(--slate-300)]">
                          -
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.currentApprovalStatus && APPROVAL_BADGE[item.currentApprovalStatus] ? (
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-semibold border ${APPROVAL_BADGE[item.currentApprovalStatus].className}`}
                        >
                          {APPROVAL_BADGE[item.currentApprovalStatus].label}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--slate-300)]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--slate-700)] whitespace-nowrap">
                      {item.currentTotalHtCents !== null
                        ? formatAmount(item.currentTotalHtCents)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--slate-400)] whitespace-nowrap">
                      {formatDate(item.currentUpdatedAt)}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <div className="inline-flex items-center gap-1">
                        <AffaireFavoriteButton
                          isFavorite={item.isFavorite}
                          isPending={favoritePendingIds.includes(item.projectId)}
                          onToggle={() =>
                            onToggleFavorite(item.projectId, !item.isFavorite)
                          }
                        />
                        {/* Hub affaire – toujours visible */}
                        <button
                          type="button"
                          title="Hub affaire"
                          className="inline-flex items-center justify-center rounded p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push(`/dashboard/affaires/${item.projectId}`);
                          }}
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
                            aria-hidden="true"
                          >
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                          </svg>
                        </button>
                        {/* Detail estimation – visible quand non-brouillon */}
                        {hasCurrentVersion && item.currentStatus !== "draft" && (
                          <button
                            type="button"
                            title="Voir le detail"
                            className="inline-flex items-center justify-center rounded p-1 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(`/dashboard/estimates/${item.currentVersionId}`);
                            }}
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
                              aria-hidden="true"
                            >
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </button>
                        )}
                        {/* Editer – visible quand brouillon */}
                        {(!hasCurrentVersion || item.currentStatus === "draft") && (
                          <button
                            type="button"
                            title="Editer l'affaire"
                            className="inline-flex items-center justify-center rounded p-1 text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(
                                hasCurrentVersion
                                  ? `/dashboard/estimates/${item.currentVersionId}/edit`
                                  : `/dashboard/affaires/${item.projectId}`
                              );
                            }}
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
                              aria-hidden="true"
                            >
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        )}
                        {/* Supprimer – visible quand brouillon */}
                        {(!hasCurrentVersion || item.currentStatus === "draft") && (
                          <button
                            type="button"
                            title="Supprimer l'affaire"
                            className="inline-flex items-center justify-center rounded p-1 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            onClick={(event) => {
                              event.stopPropagation();
                              requestDelete(item.projectId, item.projectName);
                            }}
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
                              aria-hidden="true"
                            >
                              <path d="M3 6h18" />
                              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {expanded && (
                    <tr className="expanded-content-row">
                      <td colSpan={11}>
                        <div className="expanded-content animate-expand-down">
                          {cached === "loading" ? (
                            <div className="flex items-center gap-3 rounded-xl border border-[var(--slate-100)] bg-white p-4">
                              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]" />
                              <span className="text-sm text-[var(--slate-500)]">Chargement...</span>
                            </div>
                          ) : cached === "error" ? (
                            <div className="rounded-xl border border-[var(--error)]/20 bg-[var(--error-light)] px-4 py-3 text-sm text-[var(--error)]">
                              Erreur lors du chargement.
                            </div>
                          ) : cached ? (
                            <ExpandedContent
                              data={cached}
                              projectId={item.projectId}
                              versionCount={item.versionCount}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded content — 3 column grid                                   */
/* ------------------------------------------------------------------ */

function ExpandedContent({
  data,
  projectId,
  versionCount,
}: {
  data: AffaireDenseExpandData;
  projectId: string;
  versionCount: number;
}) {
  const { summary, dpgfSource } = data;
  const cv = summary.currentVersion;
  const av = summary.acceptedVersion;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Column 1 — Résumé financier */}
      <div className="space-y-1.5 text-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)] mb-2">
          Résumé financier
        </h4>
        <p>
          <span className="text-[var(--slate-500)]">Nombre de versions : </span>
          <span>{versionCount}</span>
        </p>
        {cv ? (
          <>
            <p>
              <span className="text-[var(--slate-500)]">Total HT : </span>
              <span className="font-semibold text-[var(--slate-900)]">
                {formatAmount(cv.totalHtCents)}
              </span>
            </p>
            <p>
              <span className="text-[var(--slate-500)]">Marge : </span>
              <span className="font-medium">{cv.marginPercent.toFixed(1)} %</span>
            </p>
            <p>
              <span className="text-[var(--slate-500)]">Nb lignes : </span>
              <span>{summary.lineCount}</span>
            </p>
            <p>
              <span className="text-[var(--slate-500)]">Version courante : </span>
              <span>
                V{cv.versionNumber} — {versionStatusLabel(cv.status)}
              </span>
            </p>
            {av && (
              <p>
                <span className="text-[var(--slate-500)]">Version acceptée : </span>
                <span className="text-emerald-700 font-medium">
                  V{av.versionNumber} — {formatAmount(av.totalHtCents)}
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="text-[var(--slate-400)] italic">Aucun chiffrage en cours</p>
        )}
      </div>

      {/* Column 2 — Source DPGF */}
      <div className="space-y-1.5 text-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)] mb-2">
          Source DPGF
        </h4>
        {dpgfSource ? (
          <>
            <p>
              <span className="text-[var(--slate-500)]">Fichier : </span>
              <span className="font-medium truncate">{dpgfSource.filename}</span>
            </p>
            <p>
              <span className="text-[var(--slate-500)]">Format : </span>
              <span>{dpgfSource.sourceFormat}</span>
            </p>
            <p>
              <span className="text-[var(--slate-500)]">Lignes source : </span>
              <span>{dpgfSource.rowCount}</span>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[var(--slate-500)]">Import :</span>
              {(() => {
                const b = importStatusBadge(dpgfSource.importStatus);
                return (
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${b.className}`}
                  >
                    {b.label}
                  </span>
                );
              })()}
              {(() => {
                const b = mappingStatusBadge(dpgfSource.mappingStatus);
                if (!b) return null;
                return (
                  <>
                    <span className="text-[var(--slate-500)]">Mapping :</span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${b.className}`}
                    >
                      {b.label}
                    </span>
                  </>
                );
              })()}
            </div>
            <p>
              <span className="text-[var(--slate-500)]">Importé le : </span>
              <span>{formatDate(dpgfSource.importedAt)}</span>
            </p>
          </>
        ) : (
          <p className="text-[var(--slate-400)] italic border border-dashed border-[var(--slate-200)] rounded px-3 py-2">
            Aucune DPGF importée
          </p>
        )}
      </div>

      {/* Column 3 — Actions rapides */}
      <div className="space-y-2 text-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)] mb-2">
          Actions rapides
        </h4>
        <Link
          href={`/dashboard/affaires/${projectId}`}
          className="flex items-center gap-2 text-blue-600 hover:text-blue-800 hover:underline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Hub affaire
        </Link>
        {cv && cv.status !== "draft" && (
          <Link
            href={`/dashboard/estimates/${cv.id}`}
            className="flex items-center gap-2 text-emerald-600 hover:text-emerald-800 hover:underline"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Voir l&apos;estimation
          </Link>
        )}
        {cv && cv.status === "draft" && (
          <Link
            href={`/dashboard/estimates/${cv.id}/edit`}
            className="flex items-center gap-2 text-amber-600 hover:text-amber-800 hover:underline"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Editer le chiffrage
          </Link>
        )}
        {cv && (
          <Link
            href={`/dashboard/estimates/${cv.id}/print`}
            className="flex items-center gap-2 text-[var(--slate-600)] hover:text-[var(--slate-900)] hover:underline"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Exporter
          </Link>
        )}
      </div>
    </div>
  );
}
