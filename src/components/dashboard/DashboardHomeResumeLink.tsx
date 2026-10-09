"use client";

import Link from "next/link";

import { useLastAffaireId } from "@/hooks/useLastAffaireContext";
import { Undo2Icon } from "lucide-react";

export function DashboardHomeResumeLink() {
  const lastAffaireId = useLastAffaireId();

  if (!lastAffaireId) {
    return (
      <span
        className="flex min-h-11 items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground"
        aria-disabled="true"
      >
        Aucune affaire récente à reprendre
      </span>
    );
  }

  return (
    <Link
      href={`/dashboard/affaires/${lastAffaireId}`}
      prefetch={false}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Undo2Icon strokeWidth="1.75" aria-hidden="true" size={18} />
      Reprendre la dernière affaire
    </Link>
  );
}
