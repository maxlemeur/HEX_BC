"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui-legacy/Button";
import { Modal } from "@/components/ui-legacy/Modal";

type RejectEstimateModalProps = {
  open: boolean;
  onClose: () => void;
  token: string;
  onRejected: () => void;
};

export function RejectEstimateModal({
  open,
  onClose,
  token,
  onRejected,
}: RejectEstimateModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      setIsSubmitting(true);

      try {
        const res = await fetch(`/api/portal/${token}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: reason.trim() || undefined,
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
              : "Erreur lors du refus du devis.";
          throw new Error(errorMessage);
        }

        onRejected();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Erreur inconnue."
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, reason, onRejected]
  );

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content className="max-w-md">
        <Modal.Header>
          <Modal.Title>Refuser le devis</Modal.Title>
          <Modal.Close disabled={isSubmitting} />
        </Modal.Header>
        <form onSubmit={handleSubmit}>
          <Modal.Body>
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Êtes-vous sûr de vouloir refuser ce devis ? Cette action est
                définitive.
              </p>
              <div>
                <label
                  htmlFor="reject-reason"
                  className="mb-1.5 block text-sm font-medium text-foreground-secondary"
                >
                  Motif du refus{" "}
                  <span className="text-subtle-foreground">(optionnel)</span>
                </label>
                <textarea
                  id="reject-reason"
                  className="form-textarea w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-slate-800 placeholder:text-subtle-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={3}
                  placeholder="Indiquez la raison de votre refus..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
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
            <Button type="submit" variant="danger" loading={isSubmitting}>
              Confirmer le refus
            </Button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
