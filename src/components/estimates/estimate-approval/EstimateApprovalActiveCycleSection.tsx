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
    <section className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            Cycle {activeCycle.cycleNumber} en revue
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Demande ouverte le {formatDateTime(activeCycle.requestedAt)}
            {activeCycle.requesterName ? ` par ${activeCycle.requesterName}` : ""}
            . {activeCycle.pendingApprovalCount} règle
            {activeCycle.pendingApprovalCount > 1 ? "s" : ""} en attente.
          </p>
        </div>
        <span className="rounded-full bg-surface/80 px-2 py-0.5 text-[11px] font-medium text-primary">
          En revue
        </span>
      </div>
      {activeCycle.assignedReviewer ? (
        <p className="mt-3 text-sm text-foreground-secondary">
          Validateur assigne:{" "}
          <span className="font-medium text-slate-800">
            {activeCycle.assignedReviewer.fullName}
          </span>
          {activeCycle.assignedReviewer.workEmail
            ? ` (${activeCycle.assignedReviewer.workEmail})`
            : ""}
        </p>
      ) : null}
      {activeCycle.submissionMessage ? (
        <div className="mt-3 rounded-xl border border-white/70 bg-surface/80 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Message de contexte
          </p>
          <p className="mt-1 text-sm text-foreground-secondary">
            {activeCycle.submissionMessage}
          </p>
        </div>
      ) : null}
      <ChangesSummarySection changes={changesSinceLastCycle} />
    </section>
  );
}
