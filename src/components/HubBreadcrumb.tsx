import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";

/**
 * Legacy hub trail, kept for the affaire sub-pages. New pages use `PageHeader` breadcrumbs
 * (`@/components/layout/breadcrumbs`).
 */
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
        <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
        {hubLabel}
      </Link>
      {intermediateHref && intermediateLabel && (
        <>
          <span aria-hidden="true" className="shrink-0 text-subtle-foreground">/</span>
          <Link
            href={intermediateHref}
            className="inline-flex min-h-11 min-w-0 items-center truncate rounded-md px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-secondary-foreground sm:min-h-0"
          >
            <span className="truncate">{intermediateLabel}</span>
          </Link>
        </>
      )}
      <span aria-hidden="true" className="shrink-0 text-subtle-foreground">/</span>
      <span className="shrink-0 font-medium text-secondary-foreground" aria-current="page">{currentLabel}</span>
    </nav>
  );
}
