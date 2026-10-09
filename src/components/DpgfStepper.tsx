"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Import", href: "/dashboard/imports", step: 1 },
  { label: "Mapping", href: "/dashboard/mappings", step: 2 },
  { label: "Liaison catalogue", href: "/dashboard/catalogue", step: 3 },
] as const;

/**
 * Progress through the DPGF flow. On phones only the current step keeps its visible label
 * (the others stay announced), so the three steps fit in 320px without sideways scrolling.
 */
export function DpgfStepper({ importId }: { importId?: string | null }) {
  const pathname = usePathname();

  function resolveHref(base: string) {
    if (!importId) return base;
    if (base === "/dashboard/mappings" || base === "/dashboard/catalogue") {
      return `${base}?import_id=${encodeURIComponent(importId)}`;
    }
    return base;
  }

  const currentIndex = STEPS.findIndex((s) => pathname?.startsWith(s.href));

  return (
    <nav aria-label="Étapes du flux DPGF" className="mb-6 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-y-2">
        {STEPS.map((step, index) => {
          const isActive = index === currentIndex;
          const isDone = currentIndex > index;

          return (
            <li key={step.href} className="flex min-w-0 items-center">
              <Link
                href={resolveHref(step.href)}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-full px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-0 sm:px-4 sm:py-2",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : isDone
                      ? "bg-success-subtle text-success hover:bg-success-light"
                      : "bg-muted text-muted-foreground hover:bg-surface-subtle hover:text-foreground"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    isActive
                      ? "bg-white/20 text-primary-foreground"
                      : isDone
                        ? "bg-success text-success-foreground"
                        : "bg-surface text-muted-foreground ring-1 ring-border-strong"
                  )}
                >
                  {isDone ? <CheckIcon className="size-3" /> : step.step}
                </span>
                <span className={cn("whitespace-nowrap", !isActive && "sr-only sm:not-sr-only")}>
                  {isDone ? <span className="sr-only">Terminé : </span> : null}
                  {step.label}
                </span>
              </Link>
              {index < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn("mx-1 h-0.5 w-3 shrink-0 sm:w-8", isDone ? "bg-success" : "bg-border")}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
