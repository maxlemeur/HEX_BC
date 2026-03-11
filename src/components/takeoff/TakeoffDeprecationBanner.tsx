import Link from "next/link";

import type { TakeoffRouteHierarchyDescriptor } from "@/lib/takeoff/route-hierarchy";

export function TakeoffDeprecationBanner({
  descriptor,
  targetHref = "/dashboard/affaires",
  targetLabel = "Ouvrir le flux principal affaire",
}: {
  descriptor?: Pick<
    TakeoffRouteHierarchyDescriptor,
    "description" | "provenanceLabel" | "targetHref" | "targetLabel"
  >;
  targetHref?: string;
  targetLabel?: string;
}) {
  const resolvedTargetHref = descriptor?.targetHref ?? targetHref;
  const resolvedTargetLabel = descriptor?.targetLabel ?? targetLabel;
  const resolvedDescription =
    descriptor?.description ??
    "La vNext guide d'abord vers le parcours affaire pour lancer, suivre et reprendre le metre.";
  const resolvedProvenanceLabel =
    descriptor?.provenanceLabel ?? "Provenance du chemin : legacy estimate-first";

  return (
    <div className="alert alert-info mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
            Legacy estimate-first
          </span>
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800">
            Flux principal: affaire
          </span>
        </div>
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <p className="text-sm">
            <strong>Cette vue reste un fallback legacy.</strong> {resolvedDescription}
          </p>
        </div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--slate-500)]">
          {resolvedProvenanceLabel}
        </p>
      </div>
      {resolvedTargetHref ? (
        <Link href={resolvedTargetHref} className="btn btn-secondary btn-sm shrink-0">
          {resolvedTargetLabel}
        </Link>
      ) : null}
    </div>
  );
}
