"use client";

import Link from "next/link";

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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--slate-300)] mb-3"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <p className="text-sm text-[var(--slate-500)]">
        Aucune affaire trouvee.
      </p>
      <p className="text-xs text-[var(--slate-400)] mt-1">
        Modifiez vos filtres ou creez une nouvelle affaire.
      </p>
    </div>
  );
}

export function AffairesCardList({ items }: Readonly<Props>) {
  if (items.length === 0) {
    return <AffairesEmptyState />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.projectId}
          href={`/dashboard/estimates/${item.currentVersionId}`}
          className="dashboard-card p-4 transition-shadow hover:shadow-md cursor-pointer block"
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
            <span className="text-xs text-[var(--slate-400)] shrink-0">
              {item.versionCount} version{item.versionCount > 1 ? "s" : ""}
            </span>
          </div>

          {item.projectReference && (
            <p className="text-xs text-[var(--slate-400)] mb-2 truncate">
              Ref. {item.projectReference}
            </p>
          )}

          <div className="mb-3">
            <AffaireStatusBadges
              currentVersionNumber={item.currentVersionNumber}
              currentStatus={item.currentStatus}
              acceptedVersionNumber={item.acceptedVersionNumber}
            />
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--slate-700)]">
              {formatAmount(item.currentTotalHtCents)} HT
            </span>
            <span className="text-[var(--slate-400)]">
              {formatDate(item.currentUpdatedAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
