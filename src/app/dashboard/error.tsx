"use client";

import { useEffect } from "react";
import { CircleAlertIcon } from "lucide-react";

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
        <CircleAlertIcon strokeWidth="1.75" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-bold text-foreground">
        La vue d’ensemble n’a pas pu être chargée
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Vérifiez votre connexion, puis relancez le chargement.
      </p>
      <button type="button" className="btn btn-primary mt-6 min-h-11" onClick={reset}>
        Réessayer
      </button>
    </section>
  );
}
