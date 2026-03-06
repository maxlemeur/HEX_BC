"use client";

import { useRouter } from "next/navigation";

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

export function AffairesDenseTable({
  items,
  emptyVariant,
  onCreateAffaire,
}: Readonly<Props>) {
  const router = useRouter();
  const { requestDelete, modalProps } = useDeleteAffaire();

  return (
    <div className="dashboard-card overflow-hidden">
      <ConfirmModal {...modalProps} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--slate-200)] bg-[var(--slate-50)]">
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
              <th className="w-10" />
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

                const targetHref = hasCurrentVersion
                  ? item.currentStatus === "draft"
                    ? `/dashboard/estimates/${item.currentVersionId}/edit`
                    : `/dashboard/estimates/${item.currentVersionId}`
                  : `/dashboard/affaires/${item.projectId}`;

                return (
                  <tr
                    key={item.projectId}
                    className="border-b border-[var(--slate-100)] cursor-pointer hover:bg-[var(--slate-50)] transition-colors"
                    onClick={() => router.push(targetHref)}
                  >
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
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${APPROVAL_BADGE[item.currentApprovalStatus].className}`}
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
                      {(!hasCurrentVersion || item.currentStatus === "draft") && (
                        <button
                          type="button"
                          title="Supprimer l'affaire"
                          className="inline-flex items-center justify-center rounded p-1 text-[var(--slate-400)] hover:text-red-600 hover:bg-red-50 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
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
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
