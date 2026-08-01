"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { AffaireStatusBadges } from "./AffaireStatusBadges";
import { AffaireFavoriteButton } from "./AffaireFavoriteButton";
import { useDeleteAffaire } from "./useDeleteAffaire";
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
  selectedProjectIds?: ReadonlySet<string>;
  onToggleProjectSelection?: (projectId: string) => void;
};

const EMPTY_SELECTED_PROJECT_IDS: ReadonlySet<string> = new Set();

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

export function AffairesCardList({
  items,
  emptyVariant,
  onCreateAffaire,
  onToggleFavorite,
  favoritePendingIds,
  selectedProjectIds = EMPTY_SELECTED_PROJECT_IDS,
  onToggleProjectSelection,
}: Readonly<Props>) {
  const router = useRouter();
  const { requestDelete, modalProps } = useDeleteAffaire();

  if (items.length === 0) {
    return emptyVariant === "no-data" ? (
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
      />
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      <ConfirmModal {...modalProps} />
      {items.map((item) => {
        const hasCurrentVersion =
          item.hasCurrentVersion &&
          item.currentVersionId !== null &&
          item.currentVersionNumber !== null &&
          item.currentStatus !== null;

        const primaryHref = `/dashboard/affaires/${item.projectId}`;

        const canDelete =
          !hasCurrentVersion || item.currentStatus === "draft";

        return (
          <div
            key={item.projectId}
            className="dashboard-card animate-fade-in relative overflow-hidden transition-shadow hover:shadow-md [content-visibility:auto] [contain-intrinsic-size:auto_220px]"
          >
            <Link
              href={primaryHref}
              className="block p-4 pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-blue)] focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm text-[var(--slate-900)] truncate">
                    {item.projectName}
                  </h3>
                  {item.projectClient && (
                    <p className="text-xs text-[var(--slate-500)] truncate mt-0.5">
                      {item.projectClient}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {item.hasDpgf && (
                    <span
                      className="inline-flex items-center px-2 py-1 rounded text-[10px] font-semibold bg-blue-50 text-blue-800 border border-blue-200"
                      title="DPGF charge"
                    >
                      DPGF
                    </span>
                  )}
                  <span className="text-xs text-[var(--slate-400)]">
                    {item.versionCount} version{item.versionCount !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>

              {item.projectReference && (
                <p className="text-xs text-[var(--slate-400)] mb-2 truncate">
                  Ref. {item.projectReference}
                </p>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {hasCurrentVersion ? (
                  <AffaireStatusBadges
                    currentVersionNumber={item.currentVersionNumber!}
                    currentStatus={item.currentStatus!}
                    acceptedVersionNumber={item.acceptedVersionNumber}
                  />
                ) : (
                  <span className="text-xs font-medium text-[var(--slate-500)]">
                    Aucun chiffrage
                  </span>
                )}
                {item.currentApprovalStatus && APPROVAL_BADGE[item.currentApprovalStatus] && (
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded text-[10px] font-semibold border ${APPROVAL_BADGE[item.currentApprovalStatus].className}`}
                  >
                    {APPROVAL_BADGE[item.currentApprovalStatus].label}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--slate-700)]">
                  {item.currentTotalHtCents !== null
                    ? `${formatAmount(item.currentTotalHtCents)} HT`
                    : "—"}
                </span>
                <span className="text-[var(--slate-400)]">
                  {formatDate(item.currentUpdatedAt)}
                </span>
              </div>
            </Link>

            {/* Actions */}
            <div className="flex items-center gap-1 px-4 pb-4 pt-3 border-t border-[var(--slate-100)]">
              {canDelete && onToggleProjectSelection ? (
                <label className="mr-1 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center sm:min-h-8 sm:min-w-8">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[var(--slate-300)] text-[var(--brand-blue)]"
                    checked={selectedProjectIds.has(item.projectId)}
                    aria-label={`Selectionner l'affaire ${item.projectName}`}
                    onChange={() =>
                      onToggleProjectSelection(item.projectId)
                    }
                  />
                </label>
              ) : null}
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
                aria-label="Ouvrir le hub de l'affaire"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-blue-400 transition-colors hover:bg-blue-50 hover:text-blue-600 sm:min-h-8 sm:min-w-8"
                onClick={() => router.push(`/dashboard/affaires/${item.projectId}`)}
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
                  aria-label="Voir le détail du chiffrage"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-emerald-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 sm:min-h-8 sm:min-w-8"
                  onClick={() => router.push(`/dashboard/estimates/${item.currentVersionId}`)}
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
                    aria-hidden="true"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              )}
              {/* Editer – visible quand brouillon */}
              {canDelete && (
                <button
                  type="button"
                  title="Editer l'affaire"
                  aria-label="Éditer l'affaire"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-amber-400 transition-colors hover:bg-amber-50 hover:text-amber-600 sm:min-h-8 sm:min-w-8"
                  onClick={() => router.push(
                    hasCurrentVersion
                      ? `/dashboard/estimates/${item.currentVersionId}/edit`
                      : `/dashboard/affaires/${item.projectId}`
                  )}
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
                    aria-hidden="true"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
              {/* Supprimer – visible quand brouillon */}
              {canDelete && (
                <button
                  type="button"
                  title="Supprimer l'affaire"
                  aria-label="Supprimer l'affaire"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 sm:min-h-8 sm:min-w-8"
                  onClick={() => requestDelete(item.projectId, item.projectName)}
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
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
