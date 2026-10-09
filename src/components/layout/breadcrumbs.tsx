import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

/**
 * Trail of parent pages. On small screens only a back link to the closest parent is shown,
 * so long affaire names never push the page sideways.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  if (items.length === 0) return null;

  const parent = [...items].reverse().find((item, index) => index > 0 && item.href);
  const linkClass =
    "rounded-md px-1 py-0.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <nav aria-label="Fil d'Ariane" className={cn("min-w-0 text-sm text-muted-foreground", className)}>
      {parent?.href ? (
        <Link
          href={parent.href}
          className={cn(linkClass, "inline-flex min-h-11 items-center gap-1 sm:hidden")}
        >
          <ChevronLeft aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{parent.label}</span>
        </Link>
      ) : null}
      <ol className={cn("min-w-0 items-center gap-1", parent?.href ? "hidden sm:flex" : "flex")}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-subtle-foreground" />
              ) : null}
              {item.href && !isLast ? (
                <Link href={item.href} className={cn(linkClass, "max-w-56 truncate")}>
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn("truncate px-1", isLast && "font-medium text-foreground-secondary")}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
