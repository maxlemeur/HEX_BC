"use client";

import { useCallback, useState } from "react";

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
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Refuser le devis</DialogTitle>
          <DialogDescription>
            Êtes-vous sûr de vouloir refuser ce devis ? Cette action est
            définitive.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="reject-reason">
                Motif du refus{" "}
                <span className="font-normal text-muted-foreground">(facultatif)</span>
              </FieldLabel>
              <Textarea
                id="reject-reason"
                rows={3}
                placeholder="Indiquez la raison de votre refus…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
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
              onClick={onClose}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button type="submit" variant="danger-solid" size="lg" loading={isSubmitting}>
              Confirmer le refus
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
