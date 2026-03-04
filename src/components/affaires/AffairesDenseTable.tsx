"use client";

import { useRouter } from "next/navigation";

import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { EmptyState } from "@/components/ui/EmptyState";
import { AffaireStatusBadges } from "./AffaireStatusBadges";
import type { AffaireListItem } from "./types";

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
      <td colSpan={8} className="py-16 text-center">
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

  return (
    <div className="dashboard-card overflow-hidden">
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
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Statut courant
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Derniere acceptee
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Total HT
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--slate-500)] uppercase tracking-wider">
                Date MAJ
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
                    <td className="px-4 py-3 text-right font-medium text-[var(--slate-700)] whitespace-nowrap">
                      {item.currentTotalHtCents !== null
                        ? formatAmount(item.currentTotalHtCents)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--slate-400)] whitespace-nowrap">
                      {formatDate(item.currentUpdatedAt)}
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
