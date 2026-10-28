"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SendIcon } from "lucide-react";

import { useToast } from "@/components/ui-legacy/Toast";
import { Alert } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalUserContext } from "@/components/UserContext";
import { useDraftLock } from "@/hooks/useDraftLock";
import {
  fetchEstimateEditorData,
  fetchEstimateSendGating,
  type EstimateSendGatingResponse,
} from "@/lib/estimates/client";
import { getEstimateDraftLockSessionId } from "@/lib/estimates/draft-lock-session-client";
import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";
import { EstimateEmailSendError, sendEstimateEmailRequest } from "@/lib/email/send-estimate-client";
import { ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE } from "@/lib/email/send-estimate-contract";
import {
  clearPendingEstimateEmail,
  persistPendingEstimateEmail,
  readLegacyEstimateEmailRequestId,
  readPendingEstimateEmail,
  type PendingEstimateEmail,
} from "@/lib/email/pending-estimate-email";
import type { EstimateStatus } from "@/lib/estimates/status";

type SendEstimateModalProps = {
  open: boolean;
  onClose: () => void;
  versionId: string;
  versionStatus: EstimateStatus;
  versionUpdatedAt?: string;
  defaultSubject: string;
  defaultRecipient?: string;
  onSent?: () => void;
  onPdfPrepared?: () => void;
};

const DRAFT_REVIEW_REQUIRED = "Le devis a changé. Fermez cette fenêtre, rechargez la page et relisez le devis, puis rouvrez l’envoi. Une tentative déjà en cours peut concerner la version précédente.";
const DRAFT_REVIEW_READY = "Vérifiez le devis actualisé avant de reprendre l’envoi. Les destinataires et le message restent identiques ; une tentative déjà en cours peut concerner la version précédente.";

function buildDefaultMessage(tenantName: string | null) {
  return `Bonjour,

Veuillez trouver ci-joint notre devis pour votre projet.
Vous pouvez le consulter directement en ligne via le lien inclus dans cet e-mail.

Cordialement,${tenantName ? `\nL'équipe ${tenantName}` : ""}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseCcEmails(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SendEstimateModal({
  open,
  onClose,
  versionId,
  versionStatus,
  versionUpdatedAt,
  defaultSubject,
  defaultRecipient = "",
  onSent,
  onPdfPrepared,
}: SendEstimateModalProps) {
  const toast = useToast();
  const [sendSource, setSendSource] = useState(() => ({
    open,
    versionId,
    updatedAt: versionUpdatedAt,
  }));
  const isCurrentSendSource = sendSource.versionId === versionId;
  const concurrencyToken = sendSource.updatedAt ?? "";
  const requiresDraftLock = versionStatus === "draft";
  const draftLock = useDraftLock({
    versionId,
    enabled: open && requiresDraftLock && isCurrentSendSource,
  });
  const fieldId = useId();
  const toId = `${fieldId}-to`;
  const ccId = `${fieldId}-cc`;
  const ccHelpId = `${fieldId}-cc-help`;
  const subjectId = `${fieldId}-subject`;
  const messageId = `${fieldId}-message`;

  const [pendingSubmission, setPendingSubmission] = useState(() => readPendingEstimateEmail(versionId));
  const pendingSubmissionRef = useRef<PendingEstimateEmail | null>(pendingSubmission);
  const [reviewAfterReopen, setReviewAfterReopen] = useState(() => pendingSubmission?.requiresDraftReview === true);
  const needsReviewedDraft = requiresDraftLock && pendingSubmission?.requiresDraftReview === true;
  const hasReviewedDraft = needsReviewedDraft && reviewAfterReopen && Number.isFinite(Date.parse(concurrencyToken));
  const canSubmit = isCurrentSendSource && (needsReviewedDraft
    ? hasReviewedDraft && draftLock.isOwnedByCurrentUser
    : pendingSubmission !== null || !requiresDraftLock || draftLock.isOwnedByCurrentUser);
  const [to, setTo] = useState(pendingSubmission?.payload.to ?? defaultRecipient);
  const [ccRaw, setCcRaw] = useState(pendingSubmission?.payload.cc?.join(", ") ?? "");
  const [subject, setSubject] = useState(pendingSubmission?.payload.subject ?? defaultSubject);
  const tenantName = useOptionalUserContext()?.tenantName ?? null;
  const [message, setMessage] = useState(() => pendingSubmission?.payload.message ?? buildDefaultMessage(tenantName));
  const [formError, setFormError] = useState<string | null>(pendingSubmission?.requiresDraftReview
    ? DRAFT_REVIEW_READY : pendingSubmission ? ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE : null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [gating, setGating] = useState<EstimateSendGatingResponse | null>(null);
  const [gatingError, setGatingError] = useState<string | null>(null);
  const currentViewRef = useRef({ open, versionId, generation: 0 });
  const currentView = currentViewRef.current;
  if (currentView.open !== open || currentView.versionId !== versionId) {
    currentViewRef.current = { open, versionId, generation: currentView.generation + 1 };
    setIsSubmitting(false);
    setIsPreparingPdf(false);
  }
  const viewGeneration = currentViewRef.current.generation;
  const submittingGenerationRef = useRef<number | null>(null);

  if (sendSource.open !== open) {
    // Capture the source on opening; a live refresh cannot retarget this email.
    if (open) {
      const pending = sendSource.versionId === versionId
        ? pendingSubmissionRef.current ?? readPendingEstimateEmail(versionId)
        : readPendingEstimateEmail(versionId);
      pendingSubmissionRef.current = pending;
      setPendingSubmission(pending);
      setReviewAfterReopen(pending?.requiresDraftReview === true);
      if (pending || sendSource.versionId !== versionId) {
        setTo(pending?.payload.to ?? defaultRecipient);
        setCcRaw(pending?.payload.cc?.join(", ") ?? "");
        setSubject(pending?.payload.subject ?? defaultSubject);
        setMessage(pending?.payload.message ?? buildDefaultMessage(tenantName));
      }
      setFormError(pending?.requiresDraftReview ? DRAFT_REVIEW_READY : pending ? ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE : null);
    } else {
      setReviewAfterReopen(false);
    }
    setSendSource(open
      ? { open, versionId, updatedAt: versionUpdatedAt }
      : { ...sendSource, open });
  }

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!open || !requiresDraftLock || !isCurrentSendSource) return;
    let active = true;
    setGating(null);
    setGatingError(null);
    void fetchEstimateSendGating(versionId)
      .then((result) => { if (active) setGating(result); })
      .catch(() => {
        if (active) setGatingError("Les contrôles préalables sont indisponibles. Ils seront vérifiés à nouveau lors de la confirmation.");
      });
    return () => { active = false; };
  }, [open, requiresDraftLock, isCurrentSendSource, versionId, concurrencyToken]);

  const handleBeforePreparePdf = useCallback(async () => {
    if (isSubmitting || pendingSubmissionRef.current) {
      throw new Error("L’envoi est en cours. Attendez sa confirmation avant de préparer un autre document.");
    }
    setIsPreparingPdf(true);
    if (!canSubmit || !concurrencyToken) {
      throw new Error("Attendez la disponibilité du devis avant de préparer le PDF.");
    }
    const current = await fetchEstimateEditorData(versionId);
    if (!mountedRef.current || !currentViewRef.current.open || currentViewRef.current.generation !== viewGeneration) {
      throw new Error("La fenêtre de préparation du devis a changé. Rouvrez-la pour continuer.");
    }
    if (current.version.id !== sendSource.versionId ||
        current.version.updated_at !== concurrencyToken || current.version.status !== "draft") {
      throw new Error("Le devis a changé. Fermez cette fenêtre, vérifiez la version puis rouvrez la préparation du PDF.");
    }
    return true;
  }, [canSubmit, concurrencyToken, sendSource.versionId, versionId, isSubmitting, viewGeneration]);

  const handlePdfPrepared = useCallback(() => {
    if (!mountedRef.current || !currentViewRef.current.open || currentViewRef.current.generation !== viewGeneration) return;
    setIsPreparingPdf(false);
    toast.info({
      title: "PDF préparé",
      description: "Vérifiez le document téléchargé, puis rouvrez l’envoi pour confirmer l’email.",
    });
    onClose();
    onPdfPrepared?.();
  }, [onClose, onPdfPrepared, toast, viewGeneration]);

  const closeModal = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isSubmitting && !isPreparingPdf) {
        closeModal();
      }
    },
    [closeModal, isSubmitting, isPreparingPdf]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const generation = currentViewRef.current.generation;
      const isCurrent = () => mountedRef.current && currentViewRef.current.open && currentViewRef.current.generation === generation;
      if (!isCurrent() || isPreparingPdf || submittingGenerationRef.current === generation) return;
      setFormError(null);
      if (!isCurrentSendSource) {
        setFormError(
          "Le devis affiché a changé. Fermez cette fenêtre, vérifiez la version puis rouvrez l’envoi."
        );
        return;
      }
      if (!canSubmit) {
        setFormError("Attendez la disponibilité du devis avant de confirmer l’envoi.");
        return;
      }
      if (requiresDraftLock && !concurrencyToken.trim() && !pendingSubmissionRef.current) {
        setFormError(
          "Rechargez la page puis vérifiez le devis avant de confirmer l’envoi."
        );
        return;
      }

      const toTrimmed = to.trim();
      if (!toTrimmed) {
        setFormError("Adresse email du destinataire obligatoire.");
        return;
      }
      if (!isValidEmail(toTrimmed)) {
        setFormError("Adresse email du destinataire invalide.");
        return;
      }

      const ccEmails = parseCcEmails(ccRaw);
      const invalidCc = ccEmails.find((email) => !isValidEmail(email));
      if (invalidCc) {
        setFormError(`Adresse CC invalide : ${invalidCc}`);
        return;
      }

      const subjectTrimmed = subject.trim();
      if (!subjectTrimmed) {
        setFormError("L'objet de l'email est obligatoire.");
        return;
      }

      const messageTrimmed = message.trim();
      if (!messageTrimmed) {
        setFormError("Le message est obligatoire.");
        return;
      }

      submittingGenerationRef.current = generation;
      setIsSubmitting(true);
      try {
        let pending = pendingSubmissionRef.current;
        if (!pending) {
          const payload = {
            to: toTrimmed,
            cc: ccEmails.length > 0 ? ccEmails : undefined,
            subject: subjectTrimmed,
            message: messageTrimmed,
          };
          const legacyRequestId = await readLegacyEstimateEmailRequestId(versionId, payload);
          if (!isCurrent()) return;
          pending = {
            version: 1,
            requestId: legacyRequestId ?? globalThis.crypto.randomUUID(),
            payload,
            ...(requiresDraftLock ? { concurrencyToken } : {}),
          };
          pendingSubmissionRef.current = pending;
          setPendingSubmission(pending);
          persistPendingEstimateEmail(versionId, pending);
        }
        if (pending.requiresDraftReview && requiresDraftLock) {
          // The user has reopened the dialog after review. Verify that source
          // before reusing the original idempotency key and payload.
          const current = await fetchEstimateEditorData(versionId);
          if (!isCurrent()) return;
          if (current.version.id !== versionId || current.version.status !== "draft" ||
              current.version.updated_at !== concurrencyToken || !hasReviewedDraft) {
            throw new Error(DRAFT_REVIEW_REQUIRED);
          }
          pending = { ...pending, concurrencyToken, requiresDraftReview: false };
          pendingSubmissionRef.current = pending;
          setPendingSubmission(pending);
          persistPendingEstimateEmail(versionId, pending);
        }
        await sendEstimateEmailRequest({
          versionId,
          requestId: pending.requestId,
          payload: pending.payload,
          concurrencyToken: pending.concurrencyToken,
          ...(requiresDraftLock ? { draftLockSessionId: getEstimateDraftLockSessionId(versionId) } : {}),
        });
        if (!isCurrent()) return;

        clearPendingEstimateEmail(versionId);
        pendingSubmissionRef.current = null;
        setPendingSubmission(null);
        toast.success({
          title: "Devis envoyé",
          description: "L'envoi du devis est confirmé.",
        });
        onSent?.();
        closeModal();
      } catch (err) {
        if (!isCurrent()) return;
        if (err instanceof EstimateEmailSendError && err.canStartNewRequest) {
          clearPendingEstimateEmail(versionId, pendingSubmissionRef.current?.requestId);
          pendingSubmissionRef.current = null;
          setPendingSubmission(null);
        } else if (err instanceof EstimateEmailSendError && err.requiresDraftReview && requiresDraftLock && pendingSubmissionRef.current) {
          const pending = { ...pendingSubmissionRef.current, requiresDraftReview: true };
          pendingSubmissionRef.current = pending;
          setPendingSubmission(pending);
          setReviewAfterReopen(false);
          persistPendingEstimateEmail(versionId, pending);
        }
        setFormError(err instanceof EstimateEmailSendError && err.requiresDraftReview && requiresDraftLock
          ? DRAFT_REVIEW_REQUIRED : err instanceof Error ? err.message : ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE);
      } finally {
        if (isCurrent()) {
          submittingGenerationRef.current = null;
          setIsSubmitting(false);
        }
      }

    },
    [
      to,
      ccRaw,
      subject,
      message,
      versionId,
      toast,
      onSent,
      closeModal,
      canSubmit,
      requiresDraftLock,
      isCurrentSendSource,
      concurrencyToken,
      hasReviewedDraft,
      isPreparingPdf,
    ]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Envoyer le devis par email</DialogTitle>
          <DialogDescription>
            Le client reçoit le PDF et un lien vers le portail pour consulter le devis en ligne.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <DialogBody>
            {requiresDraftLock && isCurrentSendSource ? (
              <div className="mb-4 flex flex-col gap-3">
                {gatingError ? <Alert variant="warning">{gatingError}</Alert> : !gating ? (
                  <p role="status" className="text-sm text-muted-foreground">Vérification des conditions d’envoi…</p>
                ) : (
                  [...gating.blockingFlags, ...gating.warningFlags].map((flag) => (
                    <Alert key={flag.key} variant={flag.severity === "blocking" ? "danger" : "warning"}>
                      <strong>{flag.label}</strong> — {flag.description}
                    </Alert>
                  ))
                )}
                <p className="text-sm text-muted-foreground">
                  Choisissez la présentation du devis et vérifiez le PDF avant de confirmer l’email.
                  La préparation du document ne déclenche aucun envoi.
                </p>
                <fieldset disabled={isSubmitting || pendingSubmission !== null} aria-label="Préparation du document PDF" className="min-w-0 border-0 p-0">
                  <EstimatePdfDownloadButton
                    versionId={versionId}
                    versionStatus={versionStatus}
                    className="self-start"
                    onBeforeGenerate={handleBeforePreparePdf}
                    onSuccess={handlePdfPrepared}
                    onError={() => {
                      if (mountedRef.current && currentViewRef.current.generation === viewGeneration) setIsPreparingPdf(false);
                    }}
                  />
                </fieldset>
              </div>
            ) : null}
            <Field>
              <FieldLabel htmlFor={toId}>Destinataire *</FieldLabel>
              <Input
                id={toId}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="client@example.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={isSubmitting || pendingSubmission !== null}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={ccId}>CC</FieldLabel>
              <Input
                id={ccId}
                type="text"
                inputMode="email"
                placeholder="cc1@example.com, cc2@example.com"
                value={ccRaw}
                onChange={(e) => setCcRaw(e.target.value)}
                aria-describedby={ccHelpId}
                disabled={isSubmitting || pendingSubmission !== null}
              />
              <FieldDescription id={ccHelpId}>
                Séparez les adresses par des virgules.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={subjectId}>Objet *</FieldLabel>
              <Input
                id={subjectId}
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={isSubmitting || pendingSubmission !== null}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={messageId}>Message *</FieldLabel>
              <Textarea
                id={messageId}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isSubmitting || pendingSubmission !== null}
              />
            </Field>

            {!isCurrentSendSource ? (
              <Alert variant="warning" className="text-sm">
                Le devis affiché a changé. Fermez cette fenêtre, vérifiez la version puis rouvrez l’envoi.
              </Alert>
            ) : requiresDraftLock && !canSubmit && (!needsReviewedDraft || hasReviewedDraft) ? (
              <Alert variant={draftLock.isLockedByOther || draftLock.error ? "warning" : "info"}>
                {draftLock.error ?? (draftLock.isLockedByOther
                  ? "Ce devis est ouvert dans une autre page ou par un autre utilisateur. Fermez cette édition avant de confirmer l’envoi."
                  : "Vérification de la disponibilité du devis…")}
              </Alert>
            ) : null}
            {formError ? <Alert variant={formError === DRAFT_REVIEW_READY ? "warning" : "danger"}>{formError}</Alert> : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={closeModal}
              disabled={isSubmitting || isPreparingPdf}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={isSubmitting}
              disabled={!canSubmit || isPreparingPdf}
              leftIcon={<SendIcon aria-hidden="true" />}
            >
              Envoyer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
