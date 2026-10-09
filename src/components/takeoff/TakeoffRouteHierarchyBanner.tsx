import Link from "next/link";

import { ChevronDownIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TakeoffRouteHierarchyDescriptor } from "@/lib/takeoff/route-hierarchy";

type TakeoffRouteHierarchyBannerProps = {
  descriptor: TakeoffRouteHierarchyDescriptor;
};

export function TakeoffRouteHierarchyBanner({
  descriptor,
}: TakeoffRouteHierarchyBannerProps) {
  const toneClassName =
    descriptor.classification === "principal"
      ? "border-success-border bg-success-subtle"
      : "border-warning-border bg-warning-subtle";
  const badgeClassName =
    descriptor.classification === "principal"
      ? "bg-success-light text-success"
      : "bg-warning-light text-warning";

  return (
    <aside aria-label="Aide sur le parcours de métrés" className="mb-4 max-w-full">
      <details
        className={`group max-w-full overflow-hidden rounded-xl border ${toneClassName}`}
      >
        <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span
              className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClassName}`}
            >
              {descriptor.badgeLabel}
            </span>
            <span className="mt-1.5 block break-words text-sm font-semibold leading-5 text-foreground">
              {descriptor.title}
            </span>
          </span>
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>

        <div className="border-t border-border px-3 pb-4 pt-3 sm:px-4">
          <p className="break-words text-sm leading-6 text-muted-foreground">
            {descriptor.description}
          </p>
          <p className="mt-2 break-words text-xs font-medium leading-5 text-muted-foreground">
            {descriptor.provenanceLabel}
          </p>

          {descriptor.targetHref && descriptor.targetLabel ? (
            <Link
              href={descriptor.targetHref}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "mt-3 h-auto min-h-11 w-full whitespace-normal py-1.5 text-center sm:min-h-9 sm:w-auto"
              )}
            >
              {descriptor.targetLabel}
            </Link>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
