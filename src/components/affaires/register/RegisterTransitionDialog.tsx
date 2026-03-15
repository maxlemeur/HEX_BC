import { AFFAIRE_REGISTER_STATUS_LABELS } from "@/lib/affaires/register";

import type { PendingTransition } from "./registerTypes";
import { resolveTransitionPrompt } from "./registerViewModel";

type RegisterTransitionDialogProps = {
  pendingTransition: PendingTransition | null;
  transitionComment: string;
  isMutationPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onChangeComment: (value: string) => void;
};

export function RegisterTransitionDialog({
  pendingTransition,
  transitionComment,
  isMutationPending,
  onClose,
  onConfirm,
  onChangeComment,
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
            disabled={isMutationPending}
            onClick={onConfirm}
          >
            {prompt.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
