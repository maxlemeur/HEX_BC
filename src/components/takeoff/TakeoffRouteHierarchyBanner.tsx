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
    <div className={`mb-6 rounded-2xl border px-4 py-4 ${toneClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${badgeClassName}`}
          >
            {descriptor.badgeLabel}
          </span>
          <h2 className="mt-3 text-base font-semibold text-[var(--slate-900)]">
            {descriptor.title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">
            {descriptor.description}
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.12em] text-[var(--slate-500)]">
            {descriptor.provenanceLabel}
          </p>
        </div>

        {descriptor.targetHref && descriptor.targetLabel ? (
          <Link href={descriptor.targetHref} className="btn btn-secondary btn-sm shrink-0">
            {descriptor.targetLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
