"use client";

import { useCallback, useState } from "react";

import { SignaturePad } from "@/components/portal/SignaturePad";
import { Alert } from "@/components/ui/alert";
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

type AcceptEstimateModalProps = {
  open: boolean;
  onClose: () => void;
  token: string;
  onAccepted: () => void;
  totalTtcFormatted?: string;
  projectReference?: string | null;
};

export function AcceptEstimateModal({
  open,
  onClose,
  token,
  onAccepted,
  totalTtcFormatted,
  projectReference,
}: AcceptEstimateModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [signatureBase64, setSignatureBase64] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

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

      if (!termsAccepted) {
        setFormError("Vous devez accepter les conditions pour continuer.");
        return;
      }

      setIsSubmitting(true);

      try {
        const res = await fetch(`/api/portal/${token}/accept`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signature_base64: signatureBase64 ?? undefined,
            accepted_terms: true,
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
              : "Erreur lors de l’acceptation du devis.";
          throw new Error(errorMessage);
        }

        onAccepted();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Erreur inconnue."
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [token, signatureBase64, termsAccepted, onAccepted]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Accepter le devis</DialogTitle>
          <DialogDescription>
            Votre réponse est définitive et sera transmise à votre interlocuteur.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogBody>
            {projectReference || totalTtcFormatted ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-subtle px-4 py-3">
                {projectReference ? (
                  <Badge variant="accent" className="rounded-control font-mono">
                    {projectReference}
                  </Badge>
                ) : (
                  <span />
                )}
                {totalTtcFormatted ? (
                  <span className="text-lg font-bold tabular-nums text-primary">
                    {totalTtcFormatted}
                  </span>
                ) : null}
              </div>
            ) : null}

            <SignaturePad
              onSign={setSignatureBase64}
              onClear={() => setSignatureBase64(null)}
              disabled={isSubmitting}
            />

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                disabled={isSubmitting}
                className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border-border-strong accent-primary disabled:cursor-not-allowed"
              />
              <span className="text-sm text-foreground-secondary">
                J’accepte ce devis et ses conditions
              </span>
            </label>

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
            <Button
              type="submit"
              size="lg"
              loading={isSubmitting}
              disabled={!termsAccepted}
              className="bg-success text-success-foreground shadow-none hover:bg-success/90"
            >
              Confirmer l’acceptation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
