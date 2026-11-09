"use client";

import Link from "next/link";
import { useId } from "react";

import {
  APPLY_GUARD_REASON_LABELS,
  type ApplyGuardResult,
} from "@/lib/takeoff/guards";

import { TAKEOFF_RULE_LABELS } from "@/lib/takeoff/rules/labels";

import { confidenceColor, formatConfidencePercent } from "./shared";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

export function GuardPanel({
  guardResult,
  isAdmin,
  canOverride,
  overrideJustification,
  onReturnToReview,
  reviewHref,
  targetedReviewHref,
  onOverrideJustificationChange,
  onOverrideConfirm,
}: {
  guardResult: ApplyGuardResult;
  isAdmin: boolean;
  canOverride: boolean;
  overrideJustification: string;
  onReturnToReview?: () => void;
  reviewHref?: string;
  /** The targeted review of the job (TI-664 L5c), where each blocked line is settled. */
  targetedReviewHref?: string;
  onOverrideJustificationChange: (value: string) => void;
  onOverrideConfirm: () => void;
}) {
  const justificationId = useId();
  const justificationLength = overrideJustification.trim().length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warning bg-warning-light p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-warning">
          <span aria-hidden="true">&#9888;</span> Lignes à trancher
        </p>
        <p className="mt-2 text-sm text-foreground-secondary">
          {guardResult.blocked_items.length} item
          {guardResult.blocked_items.length > 1 ? "s sont bloqués" : " est bloqué"} :
          preuve absente, page source introuvable, restriction technique
          ou règles à recalculer.
          Revenez à la revue pour trancher chaque ligne avant application.
        </p>
        {onReturnToReview ? (
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline" }), "mt-3")}
            onClick={onReturnToReview}
          >
            Retour à la revue
          </button>
        ) : reviewHref ? (
          <Link href={reviewHref} className={cn(buttonVariants({ variant: "outline" }), "mt-3 inline-flex")}>
            Ouvrir la revue des preuves
          </Link>
        ) : null}
        {targetedReviewHref ? (
          <Link href={targetedReviewHref} className={cn(buttonVariants({ variant: "outline" }), "ml-2 mt-3 inline-flex")}>
            Trancher dans la revue ciblée
          </Link>
        ) : null}
      </div>

      <div className="max-h-[200px] overflow-auto rounded-xl border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-subtle text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Désignation</th>
              <th className="px-3 py-2">Blocage</th>
              <th className="px-3 py-2 text-center">Confiance</th>
            </tr>
          </thead>
          <tbody>
            {guardResult.blocked_items.map((blocked) => (
              <tr
                key={blocked.item_id}
                className="border-t border-border"
              >
                <td className="px-3 py-2 text-foreground">
                  {blocked.designation}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {blocked.reasons
                    .map((reason) => APPLY_GUARD_REASON_LABELS[reason])
                    .join(" · ")}
                  {/* TI-664 L5c: each failed rule with its reason (the Z1/Z2 length and the other zone's line). */}
                  {blocked.rule_failures?.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {blocked.rule_failures.map((failure) => (
                        <li key={failure.rule}>
                          <span className="font-medium text-foreground-secondary">{TAKEOFF_RULE_LABELS[failure.rule]}</span>
                          {" : "}{failure.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td
                  className={`px-3 py-2 text-center font-semibold ${confidenceColor(blocked.confidence)}`}
                >
                  {formatConfidencePercent(blocked.confidence)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {guardResult.medium_items.length > 0 && (
        <div className="rounded-xl border border-info bg-info-light p-3">
          <p className="text-xs font-semibold text-info">
            Contrôle recommandé (non bloquant)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {guardResult.medium_items.length} élément(s) présentent une confiance à confirmer ou un avertissement de quantité.
            Un contrôle humain reste recommandé, sans acquittement individuel.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-info">
              Voir les items ({guardResult.medium_items.length})
            </summary>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {guardResult.medium_items.map((medium) => (
                <li key={medium.item_id} className="flex items-center justify-between">
                  <span>{medium.designation}</span>
                  <span className={`font-semibold ${confidenceColor(medium.confidence)}`}>
                    {formatConfidencePercent(medium.confidence)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {isAdmin && (
        <div className="rounded-xl border border-danger bg-error-light p-4">
          <p className="text-xs font-semibold text-danger">
            Dérogation administrateur
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cette dérogation contourne les blocages ci-dessus. Elle exige une
            justification précise, sera enregistrée dans le journal d&apos;audit et
            ne remplace pas les preuves manquantes. Chaque ligne levée entre au
            devis comme provision interne ; le forçage n&apos;apparaît jamais dans
            le devis client.
          </p>
          <label
            htmlFor={justificationId}
            className="mt-3 block text-xs font-medium text-foreground-secondary"
          >
            Justification de la dérogation
          </label>
          <Textarea
            id={justificationId}
            name="takeoff-apply-override-justification"
            className="mt-2 w-full text-sm"
            rows={2}
            placeholder="Expliquez le contrôle réalisé et le risque accepté…"
            value={overrideJustification}
            onChange={(event) => onOverrideJustificationChange(event.target.value)}
            maxLength={500}
            autoComplete="off"
          />
          <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
            {overrideJustification.length}/500
          </p>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "danger-solid" }), "mt-2")}
            onClick={onOverrideConfirm}
            disabled={
              !canOverride || justificationLength < 10 || justificationLength > 500
            }
          >
            Appliquer avec dérogation
          </button>
          {!canOverride ? (
            <p className="mt-2 text-xs text-danger" role="status">
              Un aperçu d’impact à jour est requis avant toute dérogation.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
