"use client";

import Link from "next/link";
import { useId } from "react";

import {
  APPLY_GUARD_REASON_LABELS,
  type ApplyGuardResult,
} from "@/lib/takeoff/guards";

import { confidenceColor, formatConfidencePercent } from "./shared";

export function GuardPanel({
  guardResult,
  isAdmin,
  canOverride,
  overrideJustification,
  onReturnToReview,
  reviewHref,
  onOverrideJustificationChange,
  onOverrideConfirm,
}: {
  guardResult: ApplyGuardResult;
  isAdmin: boolean;
  canOverride: boolean;
  overrideJustification: string;
  onReturnToReview?: () => void;
  reviewHref?: string;
  onOverrideJustificationChange: (value: string) => void;
  onOverrideConfirm: () => void;
}) {
  const justificationId = useId();
  const justificationLength = overrideJustification.trim().length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--warning)] bg-warning-light p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warning)]">
          <span aria-hidden="true">&#9888;</span> Preuves à compléter
        </p>
        <p className="mt-2 text-sm text-[var(--slate-700)]">
          {guardResult.blocked_items.length} item
          {guardResult.blocked_items.length > 1 ? "s sont bloqués" : " est bloqué"} :
          confiance faible non validée, preuve absente ou page source introuvable.
          Revenez à la revue pour contrôler chaque ligne avant application.
        </p>
        {onReturnToReview ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3"
            onClick={onReturnToReview}
          >
            Retour à la revue
          </button>
        ) : reviewHref ? (
          <Link href={reviewHref} className="btn btn-secondary btn-sm mt-3 inline-flex">
            Ouvrir la revue des preuves
          </Link>
        ) : null}
      </div>

      <div className="max-h-[200px] overflow-auto rounded-xl border border-[var(--slate-200)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-600)]">
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
                className="border-t border-[var(--slate-200)]"
              >
                <td className="px-3 py-2 text-[var(--slate-800)]">
                  {blocked.designation}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--slate-600)]">
                  {blocked.reasons
                    .map((reason) => APPLY_GUARD_REASON_LABELS[reason])
                    .join(" · ")}
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
        <div className="rounded-xl border border-[var(--info)] bg-info-light p-3">
          <p className="text-xs font-semibold text-[var(--info)]">
            Confiance moyenne (non bloquante)
          </p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            {guardResult.medium_items.length} item
            {guardResult.medium_items.length > 1 ? "s ont" : " a"} une confiance
            comprise entre {Math.round(guardResult.threshold * 100)} % et 80 %.
            Un contrôle humain reste recommandé.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--info)]">
              Voir les items ({guardResult.medium_items.length})
            </summary>
            <ul className="mt-1 space-y-1 text-xs text-[var(--slate-600)]">
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
        <div className="rounded-xl border border-[var(--danger)] bg-error-light p-4">
          <p className="text-xs font-semibold text-[var(--danger)]">
            Dérogation administrateur
          </p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            Cette dérogation contourne les blocages ci-dessus. Elle exige une
            justification précise, sera enregistrée dans le journal d&apos;audit et
            ne remplace pas les preuves manquantes.
          </p>
          <label
            htmlFor={justificationId}
            className="mt-3 block text-xs font-medium text-[var(--slate-700)]"
          >
            Justification de la dérogation
          </label>
          <textarea
            id={justificationId}
            name="takeoff-apply-override-justification"
            className="form-input mt-2 w-full text-sm"
            rows={2}
            placeholder="Expliquez le contrôle réalisé et le risque accepté…"
            value={overrideJustification}
            onChange={(event) => onOverrideJustificationChange(event.target.value)}
            maxLength={500}
            autoComplete="off"
          />
          <p className="mt-1 text-right text-xs text-[var(--slate-500)] tabular-nums">
            {overrideJustification.length}/500
          </p>
          <button
            type="button"
            className="btn btn-sm mt-2 border-[var(--danger)] bg-[var(--danger)] text-white hover:opacity-90"
            onClick={onOverrideConfirm}
            disabled={
              !canOverride || justificationLength < 10 || justificationLength > 500
            }
          >
            Appliquer avec dérogation
          </button>
          {!canOverride ? (
            <p className="mt-2 text-xs text-[var(--danger)]" role="status">
              Un aperçu d’impact à jour est requis avant toute dérogation.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
