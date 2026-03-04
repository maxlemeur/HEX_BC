import Link from "next/link";

type AffaireBreadcrumbProps = {
  projectId: string;
  projectName: string;
  versionNumber: number;
  pageSuffix: string;
};

export function AffaireBreadcrumb({
  projectId,
  projectName,
  versionNumber,
  pageSuffix,
}: AffaireBreadcrumbProps) {
  const currentLabel = `V${versionNumber} - ${pageSuffix}`;
  const hubHref = "/dashboard/affaires";
  const projectHref = `/dashboard/affaires/${projectId}`;

  return (
    <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
      {/* Mobile: back arrow to project hub */}
      <Link
        href={projectHref}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:hidden"
        aria-label="Retour au projet"
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
      </Link>

      {/* Desktop: full breadcrumb */}
      <Link
        href={hubHref}
        className="hidden items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:inline-flex"
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
        Mes affaires
      </Link>
      <span className="hidden text-slate-300 sm:inline">/</span>
      <Link
        href={projectHref}
        className="hidden max-w-[200px] truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:inline-flex"
      >
        {projectName}
      </Link>
      <span className="hidden text-slate-300 sm:inline">/</span>

      <span className="font-medium text-secondary-foreground">
        {currentLabel}
      </span>
    </nav>
  );
}
