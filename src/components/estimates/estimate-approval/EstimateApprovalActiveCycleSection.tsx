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
    <section className="rounded-xl border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--slate-800)]">
            Cycle {activeCycle.cycleNumber} en revue
          </p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            Demande ouverte le {formatDateTime(activeCycle.requestedAt)}
            {activeCycle.requesterName ? ` par ${activeCycle.requesterName}` : ""}
            . {activeCycle.pendingApprovalCount} règle
            {activeCycle.pendingApprovalCount > 1 ? "s" : ""} en attente.
          </p>
        </div>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-[var(--brand-blue)]">
          En revue
        </span>
      </div>
      {activeCycle.assignedReviewer ? (
        <p className="mt-3 text-sm text-[var(--slate-700)]">
          Validateur assigne:{" "}
          <span className="font-medium text-[var(--slate-800)]">
            {activeCycle.assignedReviewer.fullName}
          </span>
          {activeCycle.assignedReviewer.workEmail
            ? ` (${activeCycle.assignedReviewer.workEmail})`
            : ""}
        </p>
      ) : null}
      {activeCycle.submissionMessage ? (
        <div className="mt-3 rounded-xl border border-white/70 bg-white/80 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
            Message de contexte
          </p>
          <p className="mt-1 text-sm text-[var(--slate-700)]">
            {activeCycle.submissionMessage}
          </p>
        </div>
      ) : null}
      <ChangesSummarySection changes={changesSinceLastCycle} />
    </section>
  );
}
