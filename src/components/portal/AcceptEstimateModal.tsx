"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui-legacy/Button";
import { Modal } from "@/components/ui-legacy/Modal";
import { SignaturePad } from "@/components/portal/SignaturePad";

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
              : "Erreur lors de l'acceptation du devis.";
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
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content className="max-w-lg">
        <Modal.Header>
          <Modal.Title>Accepter le devis</Modal.Title>
          <Modal.Close disabled={isSubmitting} />
        </Modal.Header>
        <form onSubmit={handleSubmit}>
          <Modal.Body>
            <div className="space-y-5">
              {/* Summary */}
              <div className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {projectReference && (
                      <span className="rounded-lg bg-[var(--brand-orange)]/10 px-2.5 py-1 font-mono text-sm font-bold text-[var(--brand-orange)]">
                        {projectReference}
                      </span>
                    )}
                  </div>
                  {totalTtcFormatted && (
                    <span className="text-lg font-bold text-[var(--brand-blue)]">
                      {totalTtcFormatted}
                    </span>
                  )}
                </div>
              </div>

              {/* Signature pad */}
              <SignaturePad
                onSign={setSignatureBase64}
                onClear={() => setSignatureBase64(null)}
                disabled={isSubmitting}
              />

              {/* Terms checkbox */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  disabled={isSubmitting}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--slate-300)] text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm text-[var(--slate-700)]">
                  J&apos;accepte ce devis et ses conditions
                </span>
              </label>

              {/* Error */}
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
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!termsAccepted}
              className="!bg-emerald-600 hover:!bg-emerald-700"
            >
              Confirmer l&apos;acceptation
            </Button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
