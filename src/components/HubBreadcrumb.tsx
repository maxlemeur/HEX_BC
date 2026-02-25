import Link from "next/link";

export function HubBreadcrumb({
  hubHref,
  hubLabel,
  currentLabel,
}: {
  hubHref: string;
  hubLabel: string;
  currentLabel: string;
}) {
  return (
    <nav className="mb-4 flex items-center gap-1.5 text-sm text-slate-500">
      <Link
        href={hubHref}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-slate-100 hover:text-slate-700"
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
      <span className="text-slate-300">/</span>
      <span className="font-medium text-slate-700">{currentLabel}</span>
    </nav>
  );
}
