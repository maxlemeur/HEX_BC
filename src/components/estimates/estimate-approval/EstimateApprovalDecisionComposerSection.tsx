"use client";

import { useId } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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
  const fieldId = useId();
  const scopeTypeId = `${fieldId}-scope-type`;
  const scopeTargetId = `${fieldId}-scope-target`;
  const commentId = `${fieldId}-comment`;

  return (
    <section className="@container rounded-lg border border-border bg-surface-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Commentaires de validation
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Ciblez l&apos;affaire, un lot, une ligne, une exception ou une
            hypothèse sans ouvrir l&apos;éditeur complet.
          </p>
        </div>
        {activeCycle ? (
          <Badge variant="outline" size="sm">
            Cycle {activeCycle.cycleNumber}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 @md:grid-cols-[160px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor={scopeTypeId}>Portée</FieldLabel>
          <NativeSelect
            id={scopeTypeId}
            size="sm"
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
          </NativeSelect>
        </div>

        {draftScopeType === "project" ? (
          <p className="self-end rounded-lg border border-dashed border-border bg-surface px-3 py-2 text-sm text-foreground-secondary">
            Commentaire global sur {projectLabel}.
          </p>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor={scopeTargetId}>Cible</FieldLabel>
            <NativeSelect
              id={scopeTargetId}
              size="sm"
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
            </NativeSelect>
          </div>
        )}
      </div>

      <div className="mt-3 flex min-w-0 flex-col gap-2">
        <FieldLabel htmlFor={commentId}>Commentaire</FieldLabel>
        <Textarea
          id={commentId}
          className="min-h-[100px] resize-y text-sm"
          value={draftComment}
          onChange={(event) => onCommentChange(event.target.value)}
          placeholder="Expliquez ce qui est validé, ce qui reste réservé, ou ce qui doit être corrigé."
        />
      </div>

      {formError ? (
        <Alert variant="danger" className="mt-3">
          {formError}
        </Alert>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={onAddComment}
        >
          Ajouter le commentaire
        </Button>
        {draftComments.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={onClearComments}
          >
            Vider la liste
          </Button>
        ) : null}
      </div>

      {draftComments.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {draftComments.map((comment) => (
            <li
              key={comment.id}
              className="rounded-lg border border-border bg-surface px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {SCOPE_LABELS[comment.scopeType]}
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-foreground">
                    {comment.scopeLabel}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Retirer le commentaire sur ${comment.scopeLabel}`}
                  onClick={() => onRemoveComment(comment.id)}
                >
                  Retirer
                </Button>
              </div>
              <p className="mt-2 break-words text-sm text-foreground-secondary">{comment.comment}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          variant="primary"
          size="sm"
          disabled={isPending}
          onClick={onApprove}
        >
          {isPending ? "En cours…" : DECISION_META.approved.buttonLabel}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-warning-border bg-warning-subtle text-warning hover:border-warning hover:bg-warning-light hover:text-warning"
          disabled={isPending}
          onClick={onApproveWithReservations}
        >
          {isPending
            ? "En cours…"
            : DECISION_META.approved_with_reservations.buttonLabel}
        </Button>

        <div className="ml-auto" />

        {pendingConfirm === "changes_requested" ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmer le renvoi en correction">
            <span className="text-xs font-medium text-danger">
              Confirmer le renvoi ?
            </span>
            <Button
              variant="danger-solid"
              size="sm"
              disabled={isPending}
              onClick={onConfirmRequestChanges}
            >
              {isPending ? "En cours…" : "Oui, renvoyer"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={onCancelRequestChanges}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <Button
            variant="danger"
            size="sm"
            disabled={isPending}
            onClick={onRequestChanges}
          >
            {DECISION_META.changes_requested.buttonLabel}
          </Button>
        )}
      </div>
    </section>
  );
}
