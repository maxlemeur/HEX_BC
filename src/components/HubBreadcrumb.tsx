import Link from "next/link";

export function HubBreadcrumb({
  hubHref,
  hubLabel,
  intermediateHref,
  intermediateLabel,
  currentLabel,
}: {
  hubHref: string;
  hubLabel: string;
  intermediateHref?: string;
  intermediateLabel?: string;
  currentLabel: string;
}) {
  return (
    <nav aria-label="Fil d'Ariane" className="mb-4 flex min-w-0 items-center gap-1 text-sm text-muted-foreground sm:gap-1.5">
      <Link
        href={hubHref}
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:min-h-0"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        {hubLabel}
      </Link>
      {intermediateHref && intermediateLabel && (
        <>
          <span className="shrink-0 text-slate-300">/</span>
          <Link
            href={intermediateHref}
            className="inline-flex min-h-11 min-w-0 items-center truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:min-h-0"
          >
            <span className="truncate">{intermediateLabel}</span>
          </Link>
        </>
      )}
      <span className="shrink-0 text-slate-300">/</span>
      <span className="shrink-0 font-medium text-secondary-foreground" aria-current="page">{currentLabel}</span>
    </nav>
  );
}
