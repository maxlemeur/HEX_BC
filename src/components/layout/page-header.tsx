import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small uppercase context line above the title (e.g. "Centre de pilotage"). */
  eyebrow?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  /** Status badges or key facts shown under the title. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label?: string };
  titleTestId?: string;
  className?: string;
};

/**
 * The single page heading: exactly one h1, optional trail, context and actions.
 * Actions wrap under the title on small screens instead of overflowing.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  meta,
  actions,
  back,
  titleTestId,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3 sm:mb-8", className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {back ? (
            <Link
              href={back.href}
              aria-label={back.label ?? "Retour"}
              className="mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? (
              <p className="mb-1 text-micro font-semibold uppercase tracking-wider text-brand-orange">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="typo-h1 break-words text-foreground" data-testid={titleTestId}>
              {title}
            </h1>
            {description ? (
              <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
            {meta ? <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">{meta}</div> : null}
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
