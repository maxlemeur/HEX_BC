import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Checklist de correction
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Cycle {correctionChecklist.sourceCycleNumber} renvoyé le{" "}
            {formatDateTime(correctionChecklist.decisionAt)}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral" size="sm">
            {correctionChecklist.totalCount} item
            {correctionChecklist.totalCount > 1 ? "s" : ""}
          </Badge>
          <Badge variant="warning" size="sm">
            {correctionChecklist.pendingCount} à traiter
          </Badge>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {correctionChecklist.items.map((item) => {
          const statusMeta = CORRECTION_STATUS_META[item.status];
          return (
            <li
              key={item.id}
              className="rounded-lg border border-border-subtle bg-surface-subtle p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {SCOPE_LABELS[item.scopeType]}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-foreground">
                    {item.scopeLabel}
                  </p>
                </div>
                <Badge variant={statusMeta.variant} size="sm">
                  {statusMeta.label}
                </Badge>
              </div>
              <p className="mt-2 break-words text-sm text-foreground-secondary">{item.comment}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="rounded-sm text-xs font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    Ouvrir la cible
                  </Link>
                ) : null}
                {item.lastTreatedAt ? (
                  <span className="text-xs text-muted-foreground">
                    Dernier traitement le {formatDateTime(item.lastTreatedAt)}
                    {item.lastTreatedByName ? ` par ${item.lastTreatedByName}` : ""}
                  </span>
                ) : null}
                {item.lastTreatmentNote ? (
                  <span className="break-words text-xs text-muted-foreground">
                    Note : {item.lastTreatmentNote}
                  </span>
                ) : null}
              </div>
              {canInteractWithChecklist ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    size="sm"
                    disabled={isPending || item.status === "corrected"}
                    onClick={() => onUpdateItem(item.id, "corrected")}
                  >
                    Marquer corrigé
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isPending || item.status === "to_discuss"}
                    onClick={() => onUpdateItem(item.id, "to_discuss")}
                  >
                    Marquer à discuter
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!activeCycle ? <ChangesSummarySection changes={changesSinceLastCycle} /> : null}
    </section>
  );
}
