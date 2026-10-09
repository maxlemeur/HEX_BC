"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";

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
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CheckIcon aria-hidden="true" stroke="var(--success)" size={28} />
        </div>
        <div>
          <p className="text-lg font-semibold text-slate-800">
            Fichier importé avec succès
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Passez à l&apos;étape suivante pour associer les colonnes de votre DPGF.
          </p>
        </div>
        <Link
          href={`/dashboard/mappings?import_id=${importId}`}
          className="btn btn-primary"
        >
          <span className="flex items-center gap-2">
            Mapper les colonnes
            <ArrowRightIcon aria-hidden="true" size={16} />
          </span>
        </Link>
        <button
          type="button"
          className="text-xs text-subtle-foreground hover:text-primary"
          onClick={onDismiss}
        >
          Importer un autre fichier
        </button>
      </div>
    </section>
  );
}
