"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type SendEstimateModalProps = {
  open: boolean;
  onClose: () => void;
  versionId: string;
  defaultSubject: string;
  defaultRecipient?: string;
  onSent?: () => void;
};

const DEFAULT_MESSAGE = `Bonjour,

Veuillez trouver ci-joint notre devis pour votre projet.
Vous pouvez le consulter directement en ligne via le lien inclus dans cet email.

Cordialement,
L'equipe Hydro Express`;

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
  defaultSubject,
  defaultRecipient = "",
  onSent,
}: SendEstimateModalProps) {
  const toast = useToast();

  const [to, setTo] = useState(defaultRecipient);
  const [ccRaw, setCcRaw] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !isSubmitting) {
        onClose();
      }
    },
    [isSubmitting, onClose]
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
        const res = await fetch(`/api/estimates/${versionId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: toTrimmed,
            cc: ccEmails.length > 0 ? ccEmails : undefined,
            subject: subjectTrimmed,
            message: messageTrimmed,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
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
          title: "Devis envoye",
          description: `Email envoye a ${toTrimmed}`,
        });
        onSent?.();
        onClose();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Erreur inconnue lors de l'envoi."
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [to, ccRaw, subject, message, versionId, toast, onSent, onClose]
  );

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content className="max-w-2xl">
        <Modal.Header>
          <Modal.Title>Envoyer le devis par email</Modal.Title>
          <Modal.Close disabled={isSubmitting} />
        </Modal.Header>
        <form onSubmit={handleSubmit}>
          <Modal.Body>
            <div className="space-y-4">
              <Input
                label="Destinataire *"
                type="text"
                placeholder="client@example.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={isSubmitting}
              />
              <Input
                label="CC"
                type="text"
                placeholder="cc1@example.com, cc2@example.com"
                value={ccRaw}
                onChange={(e) => setCcRaw(e.target.value)}
                helperText="Separez les adresses par des virgules"
                disabled={isSubmitting}
              />
              <Input
                label="Objet *"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={isSubmitting}
              />
              <div>
                <label
                  htmlFor="send-estimate-message"
                  className="mb-1.5 block text-sm font-medium text-[var(--slate-700)]"
                >
                  Message *
                </label>
                <textarea
                  id="send-estimate-message"
                  className="form-textarea w-full rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-800)] placeholder:text-[var(--slate-400)] focus:border-[var(--brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/20 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>

              {formError && (
                <div
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                >
                  {formError}
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Envoyer
            </Button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
