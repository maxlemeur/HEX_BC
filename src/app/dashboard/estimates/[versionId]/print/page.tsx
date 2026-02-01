import Link from "next/link";

export default function PrintEstimatePage({
  params,
}: Readonly<{ params: { versionId: string } }>) {
  const { versionId } = params;

  return (
    <div className="min-h-screen bg-white">
      <div className="no-print border-b border-[var(--slate-200)] bg-[var(--slate-50)]/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-[var(--slate-800)]">Chiffrage - Impression</h1>
            <p className="text-sm text-[var(--slate-500)]">
              Version <span className="font-mono text-[var(--slate-600)]">{versionId}</span>
            </p>
          </div>
          <Link className="btn btn-ghost btn-sm" href={`/dashboard/estimates/${versionId}`}>
            Retour
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-10">
        <div className="rounded-2xl border border-[var(--slate-200)] bg-white p-10">
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
                <path d="M7 3h10v4H7z" />
                <rect x="5" y="7" width="14" height="10" rx="2" />
                <path d="M7 17h10v4H7z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-[var(--slate-700)]">Mise en page a venir</p>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                La version imprimable sera bientot disponible.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
