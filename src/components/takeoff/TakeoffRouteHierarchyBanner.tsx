import Link from "next/link";

import type { TakeoffRouteHierarchyDescriptor } from "@/lib/takeoff/route-hierarchy";

type TakeoffRouteHierarchyBannerProps = {
  descriptor: TakeoffRouteHierarchyDescriptor;
};

export function TakeoffRouteHierarchyBanner({
  descriptor,
}: TakeoffRouteHierarchyBannerProps) {
  const toneClassName =
    descriptor.classification === "principal"
      ? "border-[var(--success)]/20 bg-[var(--success)]/5"
      : "border-[var(--warning)]/25 bg-[var(--warning)]/8";
  const badgeClassName =
    descriptor.classification === "principal"
      ? "bg-[var(--success)]/12 text-[var(--success)]"
      : "bg-[var(--warning)]/14 text-[var(--warning)]";

  return (
    <aside aria-label="Aide sur le parcours de métrés" className="mb-4 max-w-full">
      <details
        className={`group max-w-full overflow-hidden rounded-xl border ${toneClassName}`}
      >
        <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-white/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-blue)] [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span
              className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClassName}`}
            >
              {descriptor.badgeLabel}
            </span>
            <span className="mt-1.5 block break-words text-sm font-semibold leading-5 text-[var(--slate-900)]">
              {descriptor.title}
            </span>
          </span>
          <svg
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[var(--slate-500)] transition-transform duration-200 group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </summary>

        <div className="border-t border-[var(--slate-200)] px-3 pb-4 pt-3 sm:px-4">
          <p className="break-words text-sm leading-6 text-[var(--slate-600)]">
            {descriptor.description}
          </p>
          <p className="mt-2 break-words text-xs font-medium leading-5 text-[var(--slate-500)]">
            {descriptor.provenanceLabel}
          </p>

          {descriptor.targetHref && descriptor.targetLabel ? (
            <Link
              href={descriptor.targetHref}
              className="btn btn-secondary btn-sm mt-3 min-h-11 w-full whitespace-normal text-center sm:min-h-0 sm:w-auto"
            >
              {descriptor.targetLabel}
            </Link>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
