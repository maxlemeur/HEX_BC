import type {
  EstimateApprovalSummary,
  EstimateReviewCommentScope,
  EstimateReviewDecision,
} from "@/lib/estimates/rules-engine";

import type { DraftComment } from "./shared";
import { DECISION_META, SCOPE_LABELS } from "./shared";

export function EstimateApprovalDecisionComposerSection({
  activeCycle,
  projectLabel,
  draftScopeType,
  draftScopeId,
  scopeOptions,
  draftComment,
  draftComments,
  formError,
  pendingConfirm,
  isPending,
  onScopeTypeChange,
  onScopeIdChange,
  onCommentChange,
  onAddComment,
  onClearComments,
  onRemoveComment,
  onApprove,
  onApproveWithReservations,
  onRequestChanges,
  onConfirmRequestChanges,
  onCancelRequestChanges,
}: Readonly<{
  activeCycle: EstimateApprovalSummary["activeCycle"];
  projectLabel: string;
  draftScopeType: EstimateReviewCommentScope;
  draftScopeId: string | null;
  scopeOptions: ReturnType<
    typeof import("./shared").getTargetOptions
  >;
  draftComment: string;
  draftComments: DraftComment[];
  formError: string | null;
  pendingConfirm: EstimateReviewDecision | null;
  isPending: boolean;
  onScopeTypeChange: (scopeType: EstimateReviewCommentScope) => void;
  onScopeIdChange: (scopeId: string | null) => void;
  onCommentChange: (comment: string) => void;
  onAddComment: () => void;
  onClearComments: () => void;
  onRemoveComment: (commentId: string) => void;
  onApprove: () => void;
  onApproveWithReservations: () => void;
  onRequestChanges: () => void;
  onConfirmRequestChanges: () => void;
  onCancelRequestChanges: () => void;
}>) {
  return (
    <section className="rounded-xl border border-border bg-surface-subtle px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            Commentaires de validation
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Ciblez l&apos;affaire, un lot, une ligne, une exception ou une
            hypothèse sans ouvrir l&apos;éditeur complet.
          </p>
        </div>
        {activeCycle ? (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-slate-600">
            Cycle {activeCycle.cycleNumber}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
        <label className="flex flex-col gap-1 text-sm text-foreground-secondary">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Portée
          </span>
          <select
            className="input"
            value={draftScopeType}
            onChange={(event) =>
              onScopeTypeChange(event.target.value as EstimateReviewCommentScope)
            }
          >
            <option value="project">Affaire</option>
            <option value="lot">Lot</option>
            <option value="line">Ligne</option>
            <option value="exception">Exception</option>
            <option value="hypothesis">Hypothèse</option>
          </select>
        </label>

        {draftScopeType === "project" ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-3 py-2 text-sm text-slate-600">
            Commentaire global sur {projectLabel}.
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-sm text-foreground-secondary">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cible
            </span>
            <select
              className="input"
              value={draftScopeId ?? ""}
              onChange={(event) => onScopeIdChange(event.target.value || null)}
            >
              <option value="">Choisir…</option>
              {scopeOptions.map((option) => (
                <option
                  key={`${option.scopeType}-${option.scopeId ?? "project"}`}
                  value={option.scopeId ?? ""}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="mt-3 flex flex-col gap-1 text-sm text-foreground-secondary">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Commentaire
        </span>
        <textarea
          className="input min-h-[100px] resize-y py-3"
          value={draftComment}
          onChange={(event) => onCommentChange(event.target.value)}
          placeholder="Expliquez ce qui est validé, ce qui reste réservé, ou ce qui doit être corrigé."
        />
      </label>

      {formError ? (
        <p className="mt-2 text-sm text-danger">{formError}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={isPending}
          onClick={onAddComment}
        >
          Ajouter le commentaire
        </button>
        {draftComments.length > 0 ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isPending}
            onClick={onClearComments}
          >
            Vider la liste
          </button>
        ) : null}
      </div>

      {draftComments.length > 0 ? (
        <div className="mt-4 space-y-2">
          {draftComments.map((comment) => (
            <article
              key={comment.id}
              className="rounded-xl border border-border bg-surface px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {SCOPE_LABELS[comment.scopeType]}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {comment.scopeLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs text-subtle-foreground hover:text-slate-600"
                  onClick={() => onRemoveComment(comment.id)}
                >
                  Retirer
                </button>
              </div>
              <p className="mt-2 text-sm text-foreground-secondary">{comment.comment}</p>
            </article>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={isPending}
          onClick={onApprove}
        >
          {isPending ? "En cours..." : DECISION_META.approved.buttonLabel}
        </button>
        <button
          type="button"
          className="btn btn-sm border-warning bg-warning-subtle text-warning hover:bg-warning/20"
          disabled={isPending}
          onClick={onApproveWithReservations}
        >
          {isPending
            ? "En cours..."
            : DECISION_META.approved_with_reservations.buttonLabel}
        </button>

        <div className="ml-auto" />

        {pendingConfirm === "changes_requested" ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-danger">
              Confirmer le renvoi ?
            </span>
            <button
              type="button"
              className="btn btn-sm border-danger bg-danger text-white hover:bg-danger/90"
              disabled={isPending}
              onClick={onConfirmRequestChanges}
            >
              {isPending ? "En cours..." : "Oui, renvoyer"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isPending}
              onClick={onCancelRequestChanges}
            >
              Annuler
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-sm border-danger/30 bg-danger/5 text-danger hover:bg-danger/10"
            disabled={isPending}
            onClick={onRequestChanges}
          >
            {DECISION_META.changes_requested.buttonLabel}
          </button>
        )}
      </div>
    </section>
  );
}
