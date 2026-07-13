"use client";

import Link from "next/link";

import { useLastAffaireId } from "@/hooks/useLastAffaireContext";

export function DashboardHomeResumeLink() {
  const lastAffaireId = useLastAffaireId();

  if (!lastAffaireId) {
    return (
      <span
        className="flex min-h-11 items-center rounded-lg border border-dashed border-[var(--slate-200)] px-3 text-sm text-[var(--slate-500)]"
        aria-disabled="true"
      >
        Aucune affaire récente à reprendre
      </span>
    );
  }

  return (
    <Link
      href={`/dashboard/affaires/${lastAffaireId}`}
      prefetch={false}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-3 text-sm font-semibold text-[var(--brand-blue)] transition-colors hover:border-[var(--brand-blue)] hover:bg-[var(--slate-50)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-blue)]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m9 14-4-4 4-4" />
        <path d="M5 10h9a5 5 0 0 1 5 5v3" />
      </svg>
      Reprendre la dernière affaire
    </Link>
  );
}
