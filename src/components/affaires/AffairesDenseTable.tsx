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
import type { AffaireListItem } from "./types";

const APPROVAL_BADGE: Record<string, { label: string; className: string }> = {
  required: { label: "A valider", className: "bg-amber-50 text-amber-900 border-amber-200" },
  in_review: { label: "En revue", className: "bg-blue-50 text-blue-800 border-blue-200" },
  approved: { label: "Approuvee", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  changes_requested: { label: "A reprendre", className: "bg-red-50 text-red-800 border-red-200" },
};

type AffairesEmptyVariant = "no-data" | "filtered";

type Props = {
  items: AffaireListItem[];
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
  onToggleFavorite: (projectId: string, nextIsFavorite: boolean) => void;
  favoritePendingIds: string[];
};

type ManagerQueueFilter = "all" | "follow_up" | "reservations" | "revalidation";

function hasManagerFollowUpSignal(data: AffaireDenseExpandData) {
  const hubReadiness = data.summary.hubReadiness ?? null;
  if (!hubReadiness) {
    return false;
  }

  return (
    hubReadiness.status === "not_ready" ||
    hubReadiness.drivers.some((driver) => driver.code === "critical_missing_piece")
  );
}

function hasManagerReservationSignal(data: AffaireDenseExpandData) {
  return data.summary.hubReadiness?.status === "ready_with_reservations";
}

function hasManagerRevalidationSignal(data: AffaireDenseExpandData) {
  const hubReadiness = data.summary.hubReadiness ?? null;
  if (!hubReadiness) {
    return false;
  }

  return (
    hubReadiness.register.revalidationRequiredCount > 0 ||
    hubReadiness.drivers.some((driver) => driver.code === "revalidation_required")
  );
}

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

function AffairesEmptyState({
  emptyVariant,
  onCreateAffaire,
}: {
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
}) {
  return (
    <tr>
      <td colSpan={12} className="py-16 text-center">
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
            title="Creez votre premiere affaire"
            description="Demarrez un nouveau projet pour lancer votre premier chiffrage."
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
            title="Aucune affaire trouvee"
            description="Modifiez vos filtres ou votre recherche pour afficher des resultats."
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
      return "Envoye";
    case "accepted":
      return "Accepte";
    case "archived":
      return "Archive";
    default:
      return status;
  }
}

function importStatusBadge(status: string) {
  switch (status) {
    case "done":
      return { label: "Importe", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "running":
      return { label: "En cours", className: "bg-blue-50 text-blue-700 border-blue-200" };
    case "failed":
      return { label: "Echec", className: "bg-red-50 text-red-700 border-red-200" };
    default:
      return { label: status, className: "bg-gray-50 text-gray-600 border-gray-200" };
  }
}

function mappingStatusBadge(status: string | null) {
  if (!status) return null;
  switch (status) {
    case "mapped":
      return { label: "Mappe", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
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
}: Readonly<Props>) {
  const router = useRouter();
  const { requestDelete, modalProps } = useDeleteAffaire();

  const [managerFilter, setManagerFilter] = useState<ManagerQueueFilter>("all");
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

  useEffect(() => {
    items.forEach((item) => {
      ensureExpandData(item.projectId);
    });
  }, [ensureExpandData, items]);

  // Only consider expanded IDs that are in the current items (auto-reset on pagination/filter)
  const currentItemIds = useMemo(() => new Set(items.map((i) => i.projectId)), [items]);
  const isExpanded = useCallback(
    (id: string) => expandedIds.has(id) && currentItemIds.has(id),
    [expandedIds, currentItemIds]
  );

  const handleToggleExpand = useCallback(
    (projectId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(projectId)) {
          next.delete(projectId);
        } else {
          next.add(projectId);
          ensureExpandData(projectId);
        }
        return next;
      });
    },
    [ensureExpandData]
  );

  const managerFollowUpIds = useMemo(() => {
    const ids = new Set<string>();

    items.forEach((item) => {
      const cached = expandCache[item.projectId];
      if (
        cached &&
        cached !== "loading" &&
        cached !== "error" &&
        hasManagerFollowUpSignal(cached)
      ) {
        ids.add(item.projectId);
      }
    });

    return ids;
  }, [expandCache, items]);

  const managerReservationIds = useMemo(() => {
    const ids = new Set<string>();

    items.forEach((item) => {
      const cached = expandCache[item.projectId];
      if (
        cached &&
        cached !== "loading" &&
        cached !== "error" &&
        hasManagerReservationSignal(cached)
      ) {
        ids.add(item.projectId);
      }
    });

    return ids;
  }, [expandCache, items]);

  const managerRevalidationIds = useMemo(() => {
    const ids = new Set<string>();

    items.forEach((item) => {
      const cached = expandCache[item.projectId];
      if (
        cached &&
        cached !== "loading" &&
        cached !== "error" &&
        hasManagerRevalidationSignal(cached)
      ) {
        ids.add(item.projectId);
      }
    });

    return ids;
  }, [expandCache, items]);

  const pendingManagerSignalsCount = useMemo(
    () =>
      items.filter((item) => {
        const cached = expandCache[item.projectId];
        return !cached || cached === "loading";
      }).length,
    [expandCache, items]
  );

  const visibleItems = useMemo(() => {
    if (managerFilter === "all") {
      return items;
    }

    if (managerFilter === "reservations") {
      return items.filter((item) => managerReservationIds.has(item.projectId));
    }

    if (managerFilter === "revalidation") {
      return items.filter((item) => managerRevalidationIds.has(item.projectId));
    }

    return items.filter((item) => managerFollowUpIds.has(item.projectId));
  }, [items, managerFilter, managerFollowUpIds, managerReservationIds, managerRevalidationIds]);

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
              Repere les affaires visibles a relancer en priorite, a revoir sous reserves ou a rouvrir en revalidation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                managerFilter === "all"
                  ? "bg-[var(--slate-900)] text-white"
                  : "border border-[var(--slate-200)] bg-white text-[var(--slate-600)] hover:border-[var(--slate-300)]"
              }`}
              onClick={() => setManagerFilter("all")}
            >
              Toutes ({items.length})
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                managerFilter === "follow_up"
                  ? "bg-[var(--danger)] text-white"
                  : "border border-[var(--danger)]/20 bg-[var(--danger)]/5 text-[var(--danger)] hover:bg-[var(--danger)]/10"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={pendingManagerSignalsCount > 0}
              onClick={() => setManagerFilter("follow_up")}
            >
              A relancer en priorite ({managerFollowUpIds.size})
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                managerFilter === "reservations"
                  ? "bg-[var(--warning)] text-white"
                  : "border border-[var(--warning)]/20 bg-[var(--warning)]/5 text-[var(--warning)] hover:bg-[var(--warning)]/10"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={pendingManagerSignalsCount > 0}
              onClick={() => setManagerFilter("reservations")}
            >
              A revoir sous reserves ({managerReservationIds.size})
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                managerFilter === "revalidation"
                  ? "bg-[var(--brand-blue-dark)] text-white"
                  : "border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/10 text-[var(--brand-blue-dark)] hover:bg-[var(--brand-blue)]/15"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={pendingManagerSignalsCount > 0}
              onClick={() => setManagerFilter("revalidation")}
            >
              A rouvrir en revalidation ({managerRevalidationIds.size})
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--slate-500)]">
          {pendingManagerSignalsCount > 0
            ? `Qualification manager en cours sur ${pendingManagerSignalsCount} affaire${pendingManagerSignalsCount > 1 ? "s" : ""} visible${pendingManagerSignalsCount > 1 ? "s" : ""}.`
            : managerFilter === "reservations"
              ? `${managerReservationIds.size} affaire${managerReservationIds.size > 1 ? "s" : ""} a revoir sous reserves sur cette page.`
              : managerFilter === "revalidation"
                ? `${managerRevalidationIds.size} affaire${managerRevalidationIds.size > 1 ? "s" : ""} a rouvrir en revalidation sur cette page.`
                : `${managerFollowUpIds.size} affaire${managerFollowUpIds.size > 1 ? "s" : ""} a relancer en priorite sur cette page.`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--slate-200)] bg-[var(--slate-50)]">
              <th className="w-10" />
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Nom affaire
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Client
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Ref.
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Versions
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                DPGF
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Statut courant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Derniere acceptee
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Approbation
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Total HT
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Date MAJ
              </th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 ? (
              <AffairesEmptyState
                emptyVariant={managerFilter === "all" ? emptyVariant : "filtered"}
                onCreateAffaire={onCreateAffaire}
              />
            ) : (
              visibleItems.map((item) => {
                const hasCurrentVersion =
                  item.hasCurrentVersion &&
                  item.currentVersionId !== null &&
                  item.currentVersionNumber !== null &&
                  item.currentStatus !== null;

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
                        aria-label={expanded ? "Replier" : "Deplier"}
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
                    <td className="px-4 py-3 font-medium text-[var(--slate-900)] max-w-[200px] truncate">
                      {item.projectName}
                    </td>
                    <td className="px-4 py-3 text-[var(--slate-600)] max-w-[160px] truncate">
                      {item.projectClient ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-[var(--slate-400)] max-w-[120px] truncate">
                      {item.projectReference ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-center text-[var(--slate-600)]">
                      {item.versionCount}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.hasDpgf ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200">
                          DPGF
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--slate-300)]">-</span>
                      )}
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
                      <td colSpan={12}>
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
                            <ExpandedContent data={cached} projectId={item.projectId} />
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
}: {
  data: AffaireDenseExpandData;
  projectId: string;
}) {
  const { summary, dpgfSource } = data;
  const cv = summary.currentVersion;
  const av = summary.acceptedVersion;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Column 1 — Resume financier */}
      <div className="space-y-1.5 text-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)] mb-2">
          Resume financier
        </h4>
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
                <span className="text-[var(--slate-500)]">Version acceptee : </span>
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
              <span className="text-[var(--slate-500)]">Importe le : </span>
              <span>{formatDate(dpgfSource.importedAt)}</span>
            </p>
          </>
        ) : (
          <p className="text-[var(--slate-400)] italic border border-dashed border-[var(--slate-200)] rounded px-3 py-2">
            Aucune DPGF importee
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
