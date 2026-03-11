"use client";

import { type ApplyGuardResult } from "@/lib/takeoff/guards";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import { confidenceColor, formatConfidencePercent } from "./shared";

export function GuardPanel({
  guardResult,
  items,
  isAdmin,
  isVerifying,
  overrideJustification,
  onVerifyAll,
  onVerifyItem,
  onReturnToReview,
  onOverrideJustificationChange,
  onOverrideConfirm,
}: {
  guardResult: ApplyGuardResult;
  items: TakeoffJobItem[];
  isAdmin: boolean;
  isVerifying: boolean;
  overrideJustification: string;
  onVerifyAll: () => void;
  onVerifyItem: (itemId: string) => void;
  onReturnToReview?: () => void;
  onOverrideJustificationChange: (value: string) => void;
  onOverrideConfirm: () => void;
}) {
  const totalIncluded = items.filter((item) => !item.is_excluded).length;
  const verifiedCount = items.filter((item) => !item.is_excluded && item.is_verified).length;
  const progressPercent =
    totalIncluded > 0 ? Math.round((verifiedCount / totalIncluded) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--warning)] bg-warning-light p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--warning)]">
          <span aria-hidden="true">&#9888;</span> Verification requise
        </p>
        <p className="mt-2 text-sm text-[var(--slate-700)]">
          {guardResult.blocked_items.length} item(s) ont une confiance faible
          (&lt;{Math.round(guardResult.threshold * 100)}%) et n&apos;ont pas encore
          ete verifies. L&apos;IA n&apos;est pas certaine de ces donnees, une
          verification humaine est obligatoire avant application.
        </p>
        {onReturnToReview && (
          <button
            type="button"
            className="btn btn-secondary btn-sm mt-3"
            onClick={onReturnToReview}
            disabled={isVerifying}
          >
            Retour a la revue
          </button>
        )}
      </div>

      <div className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] p-3">
        <div className="flex items-center justify-between text-xs text-[var(--slate-700)]">
          <span>Progression des verifications</span>
          <span className="font-semibold">
            {verifiedCount}/{totalIncluded} verifies
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--slate-200)]">
          <div
            className="h-full rounded-full bg-[var(--success)] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-secondary btn-sm w-full"
        onClick={onVerifyAll}
        disabled={isVerifying || guardResult.blocked_items.length === 0}
      >
        {isVerifying
          ? "Verification en cours..."
          : `Tout verifier (${guardResult.blocked_items.length} item(s))`}
      </button>

      <div className="max-h-[200px] overflow-auto rounded-xl border border-[var(--slate-200)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--slate-50)] text-left text-xs uppercase tracking-wide text-[var(--slate-600)]">
            <tr>
              <th className="px-3 py-2">Designation</th>
              <th className="px-3 py-2 text-center">Confiance</th>
              <th className="px-3 py-2 text-right">Action</th>
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
                <td
                  className={`px-3 py-2 text-center font-semibold ${confidenceColor(blocked.confidence)}`}
                >
                  {formatConfidencePercent(blocked.confidence)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onVerifyItem(blocked.item_id)}
                    disabled={isVerifying}
                  >
                    Verifier
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {guardResult.medium_items.length > 0 && (
        <div className="rounded-xl border border-[var(--info)] bg-info-light p-3">
          <p className="text-xs font-semibold text-[var(--info)]">
            Items confiance moyenne (non bloquants)
          </p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            {guardResult.medium_items.length} item(s) ont une confiance moyenne
            (50-80%). Verification recommandee mais non obligatoire.
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
            Override administrateur
          </p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            Appliquer malgre les items non verifies. Une justification est obligatoire
            et sera enregistree dans le journal d&apos;audit.
          </p>
          <textarea
            className="form-input mt-2 w-full text-sm"
            rows={2}
            placeholder="Justification (min 10 caracteres)..."
            value={overrideJustification}
            onChange={(event) => onOverrideJustificationChange(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm mt-2 border-[var(--danger)] bg-[var(--danger)] text-white hover:opacity-90"
            onClick={onOverrideConfirm}
            disabled={isVerifying || overrideJustification.trim().length < 10}
          >
            Appliquer malgre les items non verifies
          </button>
        </div>
      )}
    </div>
  );
}
