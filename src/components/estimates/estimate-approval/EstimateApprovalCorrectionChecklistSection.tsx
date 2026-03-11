import Link from "next/link";

import type {
  EstimateApprovalChangesSinceLastCycle,
  EstimateApprovalSummary,
  EstimateReviewCorrectionStatus,
} from "@/lib/estimates/rules-engine";

import { ChangesSummarySection } from "./ChangesSummarySection";
import {
  CORRECTION_STATUS_META,
  SCOPE_LABELS,
  formatDateTime,
} from "./shared";

type CorrectionChecklist = NonNullable<EstimateApprovalSummary["correctionChecklist"]>;

export function EstimateApprovalCorrectionChecklistSection({
  correctionChecklist,
  activeCycle,
  changesSinceLastCycle,
  canInteractWithChecklist,
  isPending,
  onUpdateItem,
}: Readonly<{
  correctionChecklist: CorrectionChecklist | null;
  activeCycle: EstimateApprovalSummary["activeCycle"];
  changesSinceLastCycle: EstimateApprovalChangesSinceLastCycle | null;
  canInteractWithChecklist: boolean;
  isPending: boolean;
  onUpdateItem: (
    itemId: string,
    status: Exclude<EstimateReviewCorrectionStatus, "pending">
  ) => void;
}>) {
  if (!correctionChecklist) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[var(--slate-200)] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            Checklist de correction
          </h3>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Cycle {correctionChecklist.sourceCycleNumber} renvoyé le{" "}
            {formatDateTime(correctionChecklist.decisionAt)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-[var(--slate-600)]">
            {correctionChecklist.totalCount} item
            {correctionChecklist.totalCount > 1 ? "s" : ""}
          </span>
          <span className="rounded-full bg-[var(--warning-light)] px-2 py-0.5 text-[var(--warning)]">
            {correctionChecklist.pendingCount} a traiter
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {correctionChecklist.items.map((item) => {
          const statusMeta = CORRECTION_STATUS_META[item.status];
          return (
            <article
              key={item.id}
              className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                    {SCOPE_LABELS[item.scopeType]}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
                    {item.scopeLabel}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}
                >
                  {statusMeta.label}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--slate-700)]">{item.comment}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="text-xs font-medium text-[var(--brand-blue)] underline underline-offset-2"
                  >
                    Ouvrir la cible
                  </Link>
                ) : null}
                {item.lastTreatedAt ? (
                  <span className="text-xs text-[var(--slate-500)]">
                    Dernier traitement le {formatDateTime(item.lastTreatedAt)}
                    {item.lastTreatedByName ? ` par ${item.lastTreatedByName}` : ""}
                  </span>
                ) : null}
                {item.lastTreatmentNote ? (
                  <span className="text-xs text-[var(--slate-500)]">
                    Note: {item.lastTreatmentNote}
                  </span>
                ) : null}
              </div>
              {canInteractWithChecklist ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20"
                    disabled={isPending || item.status === "corrected"}
                    onClick={() => onUpdateItem(item.id, "corrected")}
                  >
                    Marquer corrige
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm border-[var(--brand-blue)] bg-[var(--brand-blue)]/10 text-[var(--brand-blue)] hover:bg-[var(--brand-blue)]/20"
                    disabled={isPending || item.status === "to_discuss"}
                    onClick={() => onUpdateItem(item.id, "to_discuss")}
                  >
                    Marquer a discuter
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {!activeCycle ? <ChangesSummarySection changes={changesSinceLastCycle} /> : null}
    </section>
  );
}
