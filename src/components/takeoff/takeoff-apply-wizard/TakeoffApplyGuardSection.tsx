"use client";

import type { ApplyGuardResult } from "@/lib/takeoff/guards";
import { TAKEOFF_RULE_LABELS } from "@/lib/takeoff/rules/labels";

import type { ForcedDrafts } from "./forced-drafts";
import { GuardPanel } from "./GuardPanel";

/**
 * The guard's verdict on the lines sent, shown only when it has something to say: the blocked lines (with the
 * administrator's forcing, coded reason and justification per line), or on level C the non-blocking note.
 */
export function TakeoffApplyGuardSection({
  guardBlocking,
  guardResult,
  isAdmin,
  canOverride,
  forcedDrafts,
  onReturnToReview,
  reviewHref,
  targetedReviewHref,
  onForcedDraftsChange,
  onOverrideConfirm,
  isLevelC,
  disabled,
}: {
  guardBlocking: boolean;
  guardResult: ApplyGuardResult | null;
  isAdmin: boolean;
  canOverride: boolean;
  forcedDrafts: ForcedDrafts;
  onReturnToReview?: () => void;
  reviewHref?: string;
  targetedReviewHref?: string;
  onForcedDraftsChange: (next: ForcedDrafts) => void;
  onOverrideConfirm: () => void;
  isLevelC: boolean;
  /** While sending: the ways out of the review are closed (the landing must follow the application from here). */
  disabled: boolean;
}) {
  if (guardBlocking && guardResult) {
    return (
      <GuardPanel
        guardResult={guardResult}
        isAdmin={isAdmin}
        canOverride={canOverride}
        forcedDrafts={forcedDrafts}
        onReturnToReview={onReturnToReview}
        reviewHref={reviewHref}
        targetedReviewHref={targetedReviewHref}
        onForcedDraftsChange={onForcedDraftsChange}
        onOverrideConfirm={onOverrideConfirm}
        disabled={disabled}
      />
    );
  }

  if (!isLevelC || !guardResult || !guardResult.passed || guardResult.medium_items.length === 0) return null;
  return (
    <div className="rounded-xl border border-info bg-info-light p-3">
      <p className="text-xs font-semibold text-info">
        Contrôle recommandé (non bloquant)
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {guardResult.medium_items.length} élément(s) présentent une confiance à confirmer ou un avertissement de quantité.
        Vous pouvez poursuivre sans acquittement individuel.
      </p>
      <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs">
        {guardResult.medium_items.filter(item => item.rule_failures?.length).map(item => <li key={item.item_id}>
          <strong>{item.designation}</strong>{item.source_file_name ? ` · ${item.source_file_name}` : ""}
          {item.source_page ? ` · page ${item.source_page}` : ""}
          {item.rule_failures?.map(failure => <p key={failure.code}>{TAKEOFF_RULE_LABELS[failure.rule]} : {failure.reason}</p>)}
        </li>)}
      </ul>
    </div>
  );
}
