import Link from "next/link";
import { InfoIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
    "Le nouveau parcours guide d’abord vers l’affaire pour lancer, suivre et reprendre le métré.";
  const resolvedProvenanceLabel =
    descriptor?.provenanceLabel ?? "Provenance du chemin : ancien parcours par chiffrage";

  return (
    <Alert variant="info" role="note" hideIcon className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning" size="sm" className="uppercase tracking-[0.12em]">
              Ancien parcours
            </Badge>
            <Badge variant="success" size="sm" className="uppercase tracking-[0.12em]">
              Flux principal : affaire
            </Badge>
          </div>
          <div className="flex items-start gap-2">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p className="text-sm text-foreground-secondary">
              <strong className="text-foreground">Cette vue reste un parcours de secours.</strong>{" "}
              {resolvedDescription}
            </p>
          </div>
          <p className="text-micro font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {resolvedProvenanceLabel}
          </p>
        </div>
        {resolvedTargetHref ? (
          <Link
            href={resolvedTargetHref}
            className={cn(buttonVariants({ variant: "outline" }), "h-auto min-h-9 shrink-0 whitespace-normal py-1.5 text-left")}
          >
            {resolvedTargetLabel}
          </Link>
        ) : null}
      </div>
    </Alert>
  );
}
