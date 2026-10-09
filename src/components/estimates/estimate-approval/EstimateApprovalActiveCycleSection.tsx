import { Badge } from "@/components/ui/badge";
import type { EstimateApprovalChangesSinceLastCycle, EstimateApprovalSummary } from "@/lib/estimates/rules-engine";

import { ChangesSummarySection } from "./ChangesSummarySection";
import { formatDateTime } from "./shared";

type ActiveCycle = NonNullable<EstimateApprovalSummary["activeCycle"]>;

export function EstimateApprovalActiveCycleSection({
  activeCycle,
  changesSinceLastCycle,
}: Readonly<{
  activeCycle: ActiveCycle | null;
  changesSinceLastCycle: EstimateApprovalChangesSinceLastCycle | null;
}>) {
  if (!activeCycle) {
    return null;
  }

  return (
    <section className="rounded-lg border border-info-border bg-info-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Cycle {activeCycle.cycleNumber} en revue
          </p>
          <p className="mt-1 text-xs text-foreground-secondary">
            Demande ouverte le {formatDateTime(activeCycle.requestedAt)}
            {activeCycle.requesterName ? ` par ${activeCycle.requesterName}` : ""}
            . {activeCycle.pendingApprovalCount} règle
            {activeCycle.pendingApprovalCount > 1 ? "s" : ""} en attente.
          </p>
        </div>
        <Badge variant="info" size="sm">
          En revue
        </Badge>
      </div>
      {activeCycle.assignedReviewer ? (
        <p className="mt-3 break-words text-sm text-foreground-secondary">
          Validateur assigné :{" "}
          <span className="font-medium text-foreground">
            {activeCycle.assignedReviewer.fullName}
          </span>
          {activeCycle.assignedReviewer.workEmail
            ? ` (${activeCycle.assignedReviewer.workEmail})`
            : ""}
        </p>
      ) : null}
      {activeCycle.submissionMessage ? (
        <div className="mt-3 rounded-lg border border-border-subtle bg-surface px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Message de contexte
          </p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-foreground-secondary">
            {activeCycle.submissionMessage}
          </p>
        </div>
      ) : null}
      <ChangesSummarySection changes={changesSinceLastCycle} />
    </section>
  );
}
