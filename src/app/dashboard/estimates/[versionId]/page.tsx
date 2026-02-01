import Link from "next/link";

import { DuplicateEstimateButton } from "@/components/estimates/DuplicateEstimateButton";

export default function EstimateDetailPage({
  params,
}: Readonly<{ params: { versionId: string } }>) {
  const { versionId } = params;

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Chiffrage</h1>
          <p className="page-description">
            Version <span className="font-mono text-[var(--slate-600)]">{versionId}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn btn-secondary btn-sm" href="/dashboard/estimates">
            Retour
          </Link>
          <Link className="btn btn-secondary btn-sm" href={`/dashboard/estimates/${versionId}/edit`}>
            Editer
          </Link>
          <DuplicateEstimateButton versionId={versionId} />
          <Link className="btn btn-primary btn-sm" href={`/dashboard/estimates/${versionId}/print`}>
            Imprimer
          </Link>
        </div>
      </div>

      <div className="dashboard-card p-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--slate-400)"
              strokeWidth="1.5"
            >
              <path d="M8 6h8" />
              <path d="M8 10h8" />
              <path d="M8 14h5" />
              <rect x="4" y="3" width="16" height="18" rx="2" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-[var(--slate-700)]">Aucune donnee de chiffrage</p>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Les details de cette version s&apos;afficheront ici.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
