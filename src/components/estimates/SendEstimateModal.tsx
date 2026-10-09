"use client";

import { useCallback, useId, useRef, useState } from "react";
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

type SendEstimateModalProps = {
  open: boolean;
  onClose: () => void;
  versionId: string;
  defaultSubject: string;
  defaultRecipient?: string;
  onSent?: () => void;
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
  defaultSubject,
  defaultRecipient = "",
  onSent,
}: SendEstimateModalProps) {
  const toast = useToast();
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
  const idempotencyKeyRef = useRef<string | null>(null);
  const submittedFingerprintRef = useRef<string | null>(null);

  const closeModal = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isSubmitting) {
        closeModal();
      }
    },
    [closeModal, isSubmitting]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

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
    ]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      disablePointerDismissal={isSubmitting}
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

            {formError ? <Alert variant="danger">{formError}</Alert> : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={closeModal}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={isSubmitting}
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
