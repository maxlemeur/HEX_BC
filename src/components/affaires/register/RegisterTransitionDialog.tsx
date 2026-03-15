import {
  AFFAIRE_REGISTER_REVALIDATION_CAUSE_LABELS,
  AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  type AffaireRegisterRevalidationCause,
  type AffaireRegisterRevalidationImpactedStage,
} from "@/lib/affaires/register";

import type { PendingTransition, RegisterRevalidationFormState } from "./registerTypes";
import { resolveTransitionPrompt } from "./registerViewModel";

type RegisterTransitionDialogProps = {
  pendingTransition: PendingTransition | null;
  transitionComment: string;
  revalidationForm: RegisterRevalidationFormState;
  isMutationPending: boolean;
  isConfirmDisabled: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onChangeComment: (value: string) => void;
  onChangeRevalidationCause: (value: AffaireRegisterRevalidationCause) => void;
  onToggleRevalidationStage: (value: AffaireRegisterRevalidationImpactedStage) => void;
  onChangeRevalidationTriggerFileName: (value: string) => void;
};

export function RegisterTransitionDialog({
  pendingTransition,
  transitionComment,
  revalidationForm,
  isMutationPending,
  isConfirmDisabled,
  onClose,
  onConfirm,
  onChangeComment,
  onChangeRevalidationCause,
  onToggleRevalidationStage,
  onChangeRevalidationTriggerFileName,
}: Readonly<RegisterTransitionDialogProps>) {
  if (!pendingTransition) {
    return null;
  }

  const prompt = resolveTransitionPrompt(pendingTransition);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        className="dashboard-card w-full max-w-xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="affaire-register-transition-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3
              id="affaire-register-transition-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              {prompt.title}
            </h3>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              {prompt.description}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={isMutationPending}
            onClick={onClose}
          >
            Fermer
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
            Entree concernee
          </p>
          <p className="mt-2 text-sm font-medium text-[var(--slate-800)]">
            {pendingTransition.entry.text}
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {pendingTransition.entry.scopeLabel} ·{" "}
            {AFFAIRE_REGISTER_STATUS_LABELS[pendingTransition.entry.status]}
          </p>
          <div className="mt-3 inline-flex rounded-full border border-[var(--slate-200)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
            {prompt.changeLabel}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--brand-blue)]/15 bg-[var(--brand-blue)]/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-blue)]">
            {prompt.impactTitle}
          </p>
          <div className="mt-2 space-y-1.5 text-sm text-[var(--slate-700)]">
            {prompt.impactItems.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </div>

        <label className="mt-4 flex flex-col gap-1 text-xs text-[var(--slate-600)]">
          {prompt.commentLabel}
          <textarea
            rows={4}
            className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
            value={transitionComment}
            onChange={(event) => onChangeComment(event.target.value)}
            placeholder={prompt.commentPlaceholder}
          />
        </label>

        {pendingTransition.kind === "request_revalidation" ? (
          <div className="mt-4 grid gap-4 rounded-xl border border-[var(--danger)]/15 bg-[var(--danger)]/5 px-4 py-4">
            <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)]">
              Cause de revalidation
              <select
                className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-sm text-[var(--slate-700)]"
                value={revalidationForm.cause}
                onChange={(event) =>
                  onChangeRevalidationCause(
                    event.target.value as AffaireRegisterRevalidationCause
                  )
                }
              >
                {Object.entries(AFFAIRE_REGISTER_REVALIDATION_CAUSE_LABELS).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                )}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)]">
              Piece ou additif declenchant (facultatif)
              <input
                className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-sm text-[var(--slate-700)]"
                value={revalidationForm.triggerFileName}
                onChange={(event) =>
                  onChangeRevalidationTriggerFileName(event.target.value)
                }
                placeholder="Ex. additif-lot-c.pdf"
              />
            </label>

            <fieldset className="grid gap-2 text-xs text-[var(--slate-600)]">
              <legend className="text-xs font-medium text-[var(--slate-700)]">
                Etapes impactees a relancer
              </legend>
              <p className="text-[11px] text-[var(--slate-500)]">
                Ciblez uniquement les etapes reellement rouvertes.
              </p>
              {Object.entries(AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS).map(
                ([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                  >
                    <input
                      type="checkbox"
                      checked={revalidationForm.impactedStages.includes(
                        value as AffaireRegisterRevalidationImpactedStage
                      )}
                      onChange={() =>
                        onToggleRevalidationStage(
                          value as AffaireRegisterRevalidationImpactedStage
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                )
              )}
            </fieldset>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isMutationPending}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isMutationPending || isConfirmDisabled}
            onClick={onConfirm}
          >
            {prompt.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
