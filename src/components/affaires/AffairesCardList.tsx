"use client";

import Link from "next/link";

import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { AffaireStatusBadges } from "./AffaireStatusBadges";
import { useDeleteAffaire } from "./useDeleteAffaire";
import type { AffaireListItem } from "./types";

const APPROVAL_BADGE: Record<string, { label: string; className: string }> = {
  required: { label: "A valider", className: "bg-amber-50 text-amber-700 border-amber-200" },
  in_review: { label: "En revue", className: "bg-blue-50 text-blue-700 border-blue-200" },
  approved: { label: "Approuvee", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  changes_requested: { label: "A reprendre", className: "bg-red-50 text-red-700 border-red-200" },
};

type AffairesEmptyVariant = "no-data" | "filtered";

type Props = {
  items: AffaireListItem[];
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
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

export function AffairesCardList({
  items,
  emptyVariant,
  onCreateAffaire,
}: Readonly<Props>) {
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <ConfirmModal {...modalProps} />
      {items.map((item) => {
        const hasCurrentVersion =
          item.hasCurrentVersion &&
          item.currentVersionId !== null &&
          item.currentVersionNumber !== null &&
          item.currentStatus !== null;

        const href = hasCurrentVersion
          ? item.currentStatus === "draft"
            ? `/dashboard/estimates/${item.currentVersionId}/edit`
            : `/dashboard/estimates/${item.currentVersionId}`
          : `/dashboard/affaires/${item.projectId}`;

        const canDelete =
          !hasCurrentVersion || item.currentStatus === "draft";

        return (
          <Link
            key={item.projectId}
            href={href}
            className="dashboard-card p-4 transition-shadow hover:shadow-md cursor-pointer block relative"
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
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-200"
                    title="DPGF charge"
                  >
                    DPGF
                  </span>
                )}
                <span className="text-xs text-[var(--slate-400)]">
                  {item.versionCount} version{item.versionCount !== 1 ? "s" : ""}
                </span>
                {canDelete && (
                  <button
                    type="button"
                    title="Supprimer l'affaire"
                    className="inline-flex items-center justify-center rounded p-1 text-[var(--slate-400)] hover:text-red-600 hover:bg-red-50 transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      requestDelete(item.projectId, item.projectName);
                    }}
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
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${APPROVAL_BADGE[item.currentApprovalStatus].className}`}
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
        );
      })}
    </div>
  );
}
