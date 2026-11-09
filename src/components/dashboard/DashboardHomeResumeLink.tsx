"use client";

import { NavigationLink as Link } from "@/components/navigation/NavigationFeedback";

import { useLastAffaireId } from "@/hooks/useLastAffaireContext";
import type { AffaireDashboardOverviewResult } from "@/lib/affaires/server";
import { Undo2Icon } from "lucide-react";

export function DashboardHomeResumeLink({ affaires = [] }: Readonly<{
  affaires?: AffaireDashboardOverviewResult["recentAffaires"];
}>) {
  const lastAffaireId = useLastAffaireId();
  const affaire = affaires.find(item => item.projectId === lastAffaireId);

  if (!lastAffaireId) {
    return (
      <span
        className="flex min-h-11 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground"
        aria-disabled="true"
      >
        Aucune affaire consultée sur cet appareil
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground" title={affaire?.projectName}>{affaire?.projectName ?? "Dernière affaire consultée"}</p>
      {affaire?.projectReference ? <p className="mt-0.5 truncate text-xs text-muted-foreground">Réf. {affaire.projectReference}</p> : null}</div>
      <Link
        href={`/dashboard/affaires/${lastAffaireId}`}
        prefetch={false}
        className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Undo2Icon strokeWidth="1.75" aria-hidden="true" size={18} />
        Reprendre
      </Link>
    </div>
  );
}
