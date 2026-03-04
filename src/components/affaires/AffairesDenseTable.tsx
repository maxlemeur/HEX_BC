"use client";

import { useRouter } from "next/navigation";

import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { AffaireStatusBadges } from "./AffaireStatusBadges";
import type { AffaireListItem } from "./types";

type Props = {
  items: AffaireListItem[];
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

function AffairesEmptyState() {
  return (
    <tr>
      <td colSpan={8} className="py-16 text-center">
        <p className="text-sm text-[var(--slate-500)]">
          Aucune affaire trouvee.
        </p>
        <p className="text-xs text-[var(--slate-400)] mt-1">
          Modifiez vos filtres ou creez une nouvelle affaire.
        </p>
      </td>
    </tr>
  );
}

export function AffairesDenseTable({ items }: Readonly<Props>) {
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
              <AffairesEmptyState />
            ) : (
              items.map((item) => (
                <tr
                  key={item.projectId}
                  className="border-b border-[var(--slate-100)] cursor-pointer hover:bg-[var(--slate-50)] transition-colors"
                  onClick={() =>
                    router.push(
                      item.currentStatus === "draft"
                        ? `/dashboard/estimates/${item.currentVersionId}/edit`
                        : `/dashboard/estimates/${item.currentVersionId}`
                    )
                  }
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
                    <AffaireStatusBadges
                      currentVersionNumber={item.currentVersionNumber}
                      currentStatus={item.currentStatus}
                      acceptedVersionNumber={null}
                    />
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
                    {formatAmount(item.currentTotalHtCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--slate-400)] whitespace-nowrap">
                    {formatDate(item.currentUpdatedAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
