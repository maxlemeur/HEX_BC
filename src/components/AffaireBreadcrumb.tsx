import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

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
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:hidden"
        aria-label="Retour au projet"
      >
        <ChevronLeftIcon aria-hidden="true" size={14} />
      </Link>

      {/* Desktop: full breadcrumb */}
      <Link
        href={hubHref}
        className="hidden items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:inline-flex"
      >
        <ChevronLeftIcon aria-hidden="true" size={14} />
        Affaires
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
