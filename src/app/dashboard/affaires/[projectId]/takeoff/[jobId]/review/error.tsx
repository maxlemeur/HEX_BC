"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="page-header">
        <h1 className="page-title">Erreur</h1>
        <p className="page-description">Impossible de charger la revue d&apos;extraction.</p>
      </div>
      <p className="text-sm text-[var(--slate-600)]">{error.message}</p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>Reessayer</button>
    </div>
  );
}
