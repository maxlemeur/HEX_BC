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
    <nav aria-label="Fil d'Ariane" className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
      <Link
        href={hubHref}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground"
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
          <span className="text-slate-300">/</span>
          <Link
            href={intermediateHref}
            className="rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground"
          >
            {intermediateLabel}
          </Link>
        </>
      )}
      <span className="text-slate-300">/</span>
      <span className="font-medium text-secondary-foreground" aria-current="page">{currentLabel}</span>
    </nav>
  );
}
