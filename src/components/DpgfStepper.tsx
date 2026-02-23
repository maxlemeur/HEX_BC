"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS = [
  { label: "Import", href: "/dashboard/imports", step: 1 },
  { label: "Mapping", href: "/dashboard/mappings", step: 2 },
  { label: "Liaison catalogue", href: "/dashboard/catalogue", step: 3 },
] as const;

export function DpgfStepper({ importId }: { importId?: string | null }) {
  const pathname = usePathname();

  function resolveHref(base: string) {
    if (!importId) return base;
    if (base === "/dashboard/mappings") return `${base}?import_id=${importId}`;
    if (base === "/dashboard/catalogue") return `${base}?import_id=${importId}`;
    return base;
  }

  const currentIndex = STEPS.findIndex((s) => pathname?.startsWith(s.href));

  return (
    <nav aria-label="Etapes du flux DPGF" className="mb-6">
      <ol className="flex items-center gap-0">
        {STEPS.map((step, index) => {
          const isActive = index === currentIndex;
          const isDone = currentIndex > index;

          return (
            <li key={step.href} className="flex items-center">
              <Link
                href={resolveHref(step.href)}
                className={`
                  inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors
                  ${isActive
                    ? "bg-[var(--brand-blue)] text-white shadow-sm"
                    : isDone
                      ? "bg-[var(--success-light)] text-[var(--success)] hover:bg-[var(--success)]/20"
                      : "bg-[var(--slate-100)] text-[var(--slate-500)] hover:bg-[var(--slate-200)]"
                  }
                `}
              >
                <span
                  className={`
                    flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold
                    ${isActive
                      ? "bg-white/20 text-white"
                      : isDone
                        ? "bg-[var(--success)] text-white"
                        : "bg-[var(--slate-300)] text-white"
                    }
                  `}
                >
                  {isDone ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 6l3 3 5-5" />
                    </svg>
                  ) : (
                    step.step
                  )}
                </span>
                {step.label}
              </Link>
              {index < STEPS.length - 1 ? (
                <div
                  className={`mx-1 h-0.5 w-8 ${
                    isDone ? "bg-[var(--success)]" : "bg-[var(--slate-200)]"
                  }`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
