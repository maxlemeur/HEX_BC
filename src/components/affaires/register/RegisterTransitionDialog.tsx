"use client";

import {
  AFFAIRE_REGISTER_REVALIDATION_CAUSE_LABELS,
  AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  type AffaireRegisterRevalidationCause,
  type AffaireRegisterRevalidationImpactedStage,
} from "@/lib/affaires/register";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

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

const FIELD_LABEL_CLASS = "flex flex-col gap-1.5 text-xs font-medium text-foreground-secondary";

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
  const prompt = pendingTransition ? resolveTransitionPrompt(pendingTransition) : null;

  return (
    <Dialog
      open={pendingTransition !== null}
      onOpenChange={(open) => {
        if (!open && !isMutationPending) {
          onClose();
        }
      }}
    >
      {pendingTransition && prompt ? (
        <DialogContent size="md" showCloseButton={!isMutationPending}>
          <DialogHeader>
            <DialogTitle>{prompt.title}</DialogTitle>
            <DialogDescription>{prompt.description}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Entrée concernée
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {pendingTransition.entry.text}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingTransition.entry.scopeLabel} ·{" "}
                {AFFAIRE_REGISTER_STATUS_LABELS[pendingTransition.entry.status]}
              </p>
              <Badge variant="outline" className="mt-3">
                {prompt.changeLabel}
              </Badge>
            </div>

            <div className="rounded-lg border border-info-border bg-info-subtle px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                {prompt.impactTitle}
              </p>
              <div className="mt-2 space-y-1.5 text-sm text-foreground-secondary">
                {prompt.impactItems.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            </div>

            <label className={FIELD_LABEL_CLASS}>
              {prompt.commentLabel}
              <Textarea
                rows={4}
                value={transitionComment}
                onChange={(event) => onChangeComment(event.target.value)}
                placeholder={prompt.commentPlaceholder}
              />
            </label>

            {pendingTransition.kind === "request_revalidation" ? (
              <div className="grid gap-4 rounded-lg border border-danger-border bg-danger-subtle px-4 py-4">
                <label className={FIELD_LABEL_CLASS}>
                  Cause de revalidation
                  <NativeSelect
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
                  </NativeSelect>
                </label>

                <label className={FIELD_LABEL_CLASS}>
                  Pièce ou additif déclenchant (facultatif)
                  <Input
                    value={revalidationForm.triggerFileName}
                    onChange={(event) =>
                      onChangeRevalidationTriggerFileName(event.target.value)
                    }
                    placeholder="Ex. additif-lot-c.pdf"
                  />
                </label>

                <fieldset className="grid gap-2 text-xs text-muted-foreground">
                  <legend className="text-xs font-medium text-foreground-secondary">
                    Étapes impactées à relancer
                  </legend>
                  <p className="text-micro text-muted-foreground">
                    Ciblez uniquement les étapes réellement rouvertes.
                  </p>
                  {Object.entries(AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS).map(
                    ([value, label]) => (
                      <label
                        key={value}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground-secondary sm:min-h-0"
                      >
                        <input
                          type="checkbox"
                          className="accent-primary"
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
          </DialogBody>

          <DialogFooter>
            <Button
              variant="outline"
              size="lg"
              disabled={isMutationPending}
              onClick={onClose}
            >
              Annuler
            </Button>
            <Button
              size="lg"
              loading={isMutationPending}
              disabled={isConfirmDisabled}
              onClick={onConfirm}
            >
              {prompt.actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
