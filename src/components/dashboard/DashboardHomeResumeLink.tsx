"use client";

import Link from "next/link";

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
        className="block min-w-0 truncate text-sm text-muted-foreground"
        title="Aucune affaire consultée sur cet appareil"
        aria-disabled="true"
      >
        Aucune affaire consultée sur cet appareil
      </span>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <p className="min-w-0 truncate text-sm font-semibold text-foreground" title={[affaire?.projectName ?? "Dernière affaire consultée", affaire?.projectReference].filter(Boolean).join(" — ")}>
        {affaire?.projectName ?? "Dernière affaire consultée"}
      </p>
      <Link
        href={`/dashboard/affaires/${lastAffaireId}`}
        prefetch={false}
        className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md px-2 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Undo2Icon strokeWidth="1.75" aria-hidden="true" size={18} />
        Reprendre
      </Link>
    </div>
  );
}
