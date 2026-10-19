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
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
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

function fallbackFingerprintHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function getSubmissionStorageKey(versionId: string, fingerprint: string) {
  let fingerprintHash = fallbackFingerprintHash(fingerprint);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(fingerprint)
    );
    fingerprintHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }
  return `estimate-email:${versionId}:${fingerprintHash}`;
}

function readPendingIdempotencyKey(storageKey: string) {
  try {
    return globalThis.sessionStorage?.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
}

function persistPendingIdempotencyKey(storageKey: string, value: string) {
  try {
    globalThis.sessionStorage?.setItem(storageKey, value);
  } catch {
    // sessionStorage can be unavailable in hardened browser contexts.
  }
}

function clearPendingIdempotencyKey(storageKey: string) {
  try {
    globalThis.sessionStorage?.removeItem(storageKey);
  } catch {
    // A deterministic failure can still be retried with a fresh request key.
  }
}

function clearConfirmedIdempotencyKeys(versionId: string) {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    const prefix = `estimate-email:${versionId}:`;
    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch {
    // A confirmed send must not fail because browser storage is unavailable.
  }
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
  const canSubmit =
    isCurrentSendSource && (!requiresDraftLock || draftLock.isOwnedByCurrentUser);
  const fieldId = useId();
  const toId = `${fieldId}-to`;
  const ccId = `${fieldId}-cc`;
  const ccHelpId = `${fieldId}-cc-help`;
  const subjectId = `${fieldId}-subject`;
  const messageId = `${fieldId}-message`;

  const [to, setTo] = useState(defaultRecipient);
  const [ccRaw, setCcRaw] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const tenantName = useOptionalUserContext()?.tenantName ?? null;
  const [message, setMessage] = useState(() => buildDefaultMessage(tenantName));
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [gating, setGating] = useState<EstimateSendGatingResponse | null>(null);
  const [gatingError, setGatingError] = useState<string | null>(null);
  const currentViewRef = useRef({ open, versionId });
  currentViewRef.current = { open, versionId };
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittedFingerprintRef = useRef<string | null>(null);

  if (sendSource.open !== open) {
    // Capture the exact displayed source only when opening the dialog. A live
    // refresh must not adopt a newer timestamp or retarget the prepared email.
    if (open && sendSource.versionId !== versionId) {
      idempotencyKeyRef.current = null;
      submittedFingerprintRef.current = null;
    }
    setSendSource(open
      ? { open, versionId, updatedAt: versionUpdatedAt }
      : { ...sendSource, open });
  }

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
    if (isSubmitting) {
      throw new Error("L’envoi est en cours. Attendez sa confirmation avant de préparer un autre document.");
    }
    setIsPreparingPdf(true);
    if (!canSubmit || !concurrencyToken) {
      throw new Error("Attendez la disponibilité du devis avant de préparer le PDF.");
    }
    const current = await fetchEstimateEditorData(versionId);
    if (current.version.id !== sendSource.versionId ||
        current.version.updated_at !== concurrencyToken || current.version.status !== "draft") {
      throw new Error("Le devis a changé. Fermez cette fenêtre, vérifiez la version puis rouvrez la préparation du PDF.");
    }
    return true;
  }, [canSubmit, concurrencyToken, sendSource.versionId, versionId, isSubmitting]);

  const handlePdfPrepared = useCallback(() => {
    setIsPreparingPdf(false);
    if (!currentViewRef.current.open || currentViewRef.current.versionId !== versionId) return;
    toast.info({
      title: "PDF préparé",
      description: "Vérifiez le document téléchargé, puis rouvrez l’envoi pour confirmer l’email.",
    });
    onClose();
    onPdfPrepared?.();
  }, [onClose, onPdfPrepared, toast, versionId]);

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
      if (isPreparingPdf) return;
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
      if (requiresDraftLock && !concurrencyToken.trim()) {
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

      setIsSubmitting(true);
      try {
        const submittedFingerprint = JSON.stringify({
          to: toTrimmed,
          cc: ccEmails,
          subject: subjectTrimmed,
          message: messageTrimmed,
        });
        const storageKey = await getSubmissionStorageKey(
          versionId,
          submittedFingerprint
        );
        const idempotencyKey =
          submittedFingerprintRef.current === submittedFingerprint
            ? (idempotencyKeyRef.current ??
              readPendingIdempotencyKey(storageKey) ??
              globalThis.crypto.randomUUID())
            : (readPendingIdempotencyKey(storageKey) ??
              globalThis.crypto.randomUUID());
        idempotencyKeyRef.current = idempotencyKey;
        submittedFingerprintRef.current = submittedFingerprint;
        persistPendingIdempotencyKey(storageKey, idempotencyKey);
        const res = await fetch(`/api/estimates/${versionId}/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            ...(requiresDraftLock ? {
              "If-Match": concurrencyToken,
              [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: getEstimateDraftLockSessionId(versionId),
            } : {}),
          },
          body: JSON.stringify({
            to: toTrimmed,
            cc: ccEmails.length > 0 ? ccEmails : undefined,
            subject: subjectTrimmed,
            message: messageTrimmed,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          const errorCode =
            data &&
            typeof data === "object" &&
            "error" in data &&
            typeof (data as Record<string, unknown>).error === "object"
              ? (data as { error?: { code?: unknown } }).error?.code
              : null;
          if (
            errorCode === "ESTIMATE_EMAIL_PROVIDER_REJECTED" ||
            errorCode === "ESTIMATE_EMAIL_PDF_UNAVAILABLE" ||
            errorCode === "ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST"
          ) {
            clearPendingIdempotencyKey(storageKey);
            idempotencyKeyRef.current = null;
            submittedFingerprintRef.current = null;
          }
          const errorMessage =
            data &&
            typeof data === "object" &&
            "error" in data &&
            typeof (data as Record<string, unknown>).error === "string"
              ? ((data as Record<string, unknown>).error as string)
              : data &&
                  typeof data === "object" &&
                  "error" in data &&
                  typeof (data as Record<string, unknown>).error === "object" &&
                  (data as { error: { message?: string } }).error?.message
                ? (data as { error: { message: string } }).error.message
                : "Erreur lors de l'envoi du devis.";
          throw new Error(errorMessage);
        }

        toast.success({
          title: "Devis envoyé",
          description: "L'envoi du devis est confirmé.",
        });
        clearConfirmedIdempotencyKeys(versionId);
        idempotencyKeyRef.current = null;
        submittedFingerprintRef.current = null;
        onSent?.();
        closeModal();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Erreur inconnue lors de l'envoi."
        );
      } finally {
        setIsSubmitting(false);
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
                <fieldset disabled={isSubmitting} aria-label="Préparation du document PDF" className="min-w-0 border-0 p-0">
                  <EstimatePdfDownloadButton
                    versionId={versionId}
                    versionStatus={versionStatus}
                    className="self-start"
                    onBeforeGenerate={handleBeforePreparePdf}
                    onSuccess={handlePdfPrepared}
                    onError={() => setIsPreparingPdf(false)}
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
                disabled={isSubmitting}
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
                disabled={isSubmitting}
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
                disabled={isSubmitting}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={messageId}>Message *</FieldLabel>
              <Textarea
                id={messageId}
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isSubmitting}
              />
            </Field>

            {!isCurrentSendSource ? (
              <Alert variant="warning" className="text-sm">
                Le devis affiché a changé. Fermez cette fenêtre, vérifiez la version puis rouvrez l’envoi.
              </Alert>
            ) : requiresDraftLock && !canSubmit ? (
              <Alert variant={draftLock.isLockedByOther || draftLock.error ? "warning" : "info"}>
                {draftLock.error ?? (draftLock.isLockedByOther
                  ? "Ce devis est ouvert dans une autre page ou par un autre utilisateur. Fermez cette édition avant de confirmer l’envoi."
                  : "Vérification de la disponibilité du devis…")}
              </Alert>
            ) : null}
            {formError ? <Alert variant="danger">{formError}</Alert> : null}
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
