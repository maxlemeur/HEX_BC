"use client";

import { Button } from "@/components/ui/button";

export function EstimateAutomaticKfoNotice({ refresh, isReadOnly }: {
  refresh?: { staleCount: number; onRefresh: () => void };
  isReadOnly: boolean;
}) {
  if (!refresh || refresh.staleCount === 0 || isReadOnly) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-sm text-foreground"
      role="status"
      data-testid="estimate-editor-stale-kfo-notice"
    >
      <span className="min-w-0 flex-1">
        {refresh.staleCount > 1
          ? `${refresh.staleCount} K FO automatiques ne suivent plus les coefficients enregistrés.`
          : "1 K FO automatique ne suit plus le coefficient enregistré."}
      </span>
      <Button
        type="button"
        variant="outline"
        size="md"
        aria-label="Actualiser les K FO automatiques"
        onClick={refresh.onRefresh}
      >
        Actualiser
      </Button>
    </div>
  );
}
