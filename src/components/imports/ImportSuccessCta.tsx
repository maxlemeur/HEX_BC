"use client";

import Link from "next/link";

type ImportSuccessCtaProps = {
  importId: string;
  onDismiss: () => void;
};

export function ImportSuccessCta({
  importId,
  onDismiss,
}: ImportSuccessCtaProps) {
  return (
    <section className="dashboard-card p-8 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--success)]/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div>
          <p className="text-lg font-semibold text-[var(--slate-800)]">
            Fichier importé avec succès
          </p>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Passez à l&apos;étape suivante pour associer les colonnes de votre DPGF.
          </p>
        </div>
        <Link
          href={`/dashboard/mappings?import_id=${importId}`}
          className="btn btn-primary"
        >
          <span className="flex items-center gap-2">
            Mapper les colonnes
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </span>
        </Link>
        <button
          type="button"
          className="text-xs text-[var(--slate-400)] hover:text-[var(--brand-blue)]"
          onClick={onDismiss}
        >
          Importer un autre fichier
        </button>
      </div>
    </section>
  );
}
