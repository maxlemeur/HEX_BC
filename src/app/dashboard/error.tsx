"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error("Dashboard render failed", error);
  }, [error]);

  return (
    <section className="dashboard-card mx-auto max-w-xl px-6 py-12 text-center" role="alert">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </div>
      <h1 className="mt-4 text-xl font-bold text-[var(--slate-900)]">
        La vue d’ensemble n’a pas pu être chargée
      </h1>
      <p className="mt-2 text-sm leading-6 text-[var(--slate-600)]">
        Vérifiez votre connexion, puis relancez le chargement.
      </p>
      <button type="button" className="btn btn-primary mt-6 min-h-11" onClick={reset}>
        Réessayer
      </button>
    </section>
  );
}
