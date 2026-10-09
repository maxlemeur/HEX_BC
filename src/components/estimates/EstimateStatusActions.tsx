"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EstimateStatus } from "@/lib/estimates/status";
import { SendIcon } from "lucide-react";

type EstimateEmailDispatchProblem = {
  id: string;
  status: "unknown" | "failed";
  lastErrorMessage: string | null;
};

type EstimateStatusActionsProps = {
  versionId: string;
  currentStatus: EstimateStatus;
  /** updated_at réel de la version, utilisé comme jeton de concurrence (If-Match). */
  updatedAt: string;
  projectName?: string;
  clientEmail?: string;
  emailDispatchProblem?: EstimateEmailDispatchProblem | null;
};

const STATUS_TRANSITIONS: Record<
  EstimateStatus,
  { label: string; nextStatus: EstimateStatus }[]
> = {
  draft: [{ label: "Marquer envoyé", nextStatus: "sent" }],
  sending: [],
  sent: [
    { label: "Marquer accepté", nextStatus: "accepted" },
    { label: "Archiver", nextStatus: "archived" },
  ],
  accepted: [{ label: "Archiver", nextStatus: "archived" }],
  archived: [],
};

const SEND_ICON = <SendIcon aria-hidden="true" />;

export function EstimateStatusActions({
  versionId,
  currentStatus,
  updatedAt,
  projectName,
  clientEmail,
  emailDispatchProblem = null,
}: EstimateStatusActionsProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusChange = useCallback(
    async (nextStatus: EstimateStatus) => {
      setIsPending(true);
      setError(null);
      try {
        const response = await fetch(`/api/estimates/${versionId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            // Jeton de concurrence réel : ne jamais fabriquer un horodatage,
            // sous peine de conflit systématique ou de contournement.
            "If-Match": updatedAt,
          },
          // Pas de force: la transition draft -> sent passe par le gating
          // (anomalies bloquantes, PDF, scellement). Le forçage reste réservé
          // au flux d'envoi dédié réservé aux administrateurs.
          body: JSON.stringify({ status: nextStatus }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          const errorObject =
            data && typeof data === "object" && "error" in data
              ? (data as { error?: { message?: string; code?: string } }).error
              : null;
          const code = errorObject?.code;
          let message =
            errorObject?.message ?? "Impossible de mettre à jour le statut.";
          if (code === "ESTIMATE_GATING_BLOCKED") {
            message =
              "Envoi bloqué : des anomalies bloquantes doivent être corrigées avant de marquer le devis envoyé.";
          } else if (code === "VERSION_CONFLICT") {
            message =
              "Le devis a été modifié entre-temps. Rechargez la page avant de réessayer.";
          }
          setError(message);
          return;
        }

        router.refresh();
      } catch {
        setError("Impossible de mettre à jour le statut. Réessayez.");
      } finally {
        setIsPending(false);
      }
    },
    [versionId, updatedAt, router]
  );

  const [providerMessageId, setProviderMessageId] = useState("");
  const canMarkEmailSent = emailDispatchProblem?.status === "unknown";

  const handleMarkEmailSent = useCallback(async () => {
    if (!emailDispatchProblem || emailDispatchProblem.status !== "unknown") {
      return;
    }
    const providerId = providerMessageId.trim();
    if (!providerId) {
      setError(
        "Indiquez l'identifiant du message chez le fournisseur avant de marquer l'envoi."
      );
      return;
    }
    setIsPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/estimates/${versionId}/email-dispatch/reconcile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dispatchId: emailDispatchProblem.id,
            resolution: "sent",
            providerId,
          }),
        }
      );
      if (!response.ok) {
        setError("Impossible de marquer l'email comme envoyé.");
        return;
      }
      router.refresh();
    } catch {
      setError("Impossible de marquer l'email comme envoyé.");
    } finally {
      setIsPending(false);
    }
  }, [emailDispatchProblem, providerMessageId, router, versionId]);

  const transitions = STATUS_TRANSITIONS[currentStatus];
  const showEmailButton =
    currentStatus === "draft" ||
    currentStatus === "sending" ||
    currentStatus === "sent";

  if (transitions.length === 0 && !showEmailButton && !emailDispatchProblem) {
    return null;
  }

  const defaultSubject = projectName
    ? `Devis - ${projectName}`
    : "Devis";

  return (
    <>
      {emailDispatchProblem ? (
        <Alert
          variant="warning"
          className="mt-2 px-3 py-2 text-xs"
          data-testid="estimate-email-dispatch-problem"
        >
          <AlertDescription>
            <p>
              Envoi email{" "}
              {emailDispatchProblem.status === "unknown"
                ? "indéterminé"
                : "échoué"}
              {emailDispatchProblem.lastErrorMessage
                ? ` : ${emailDispatchProblem.lastErrorMessage}`
                : "."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                size="xs"
                disabled={isPending}
                onClick={() => setSendModalOpen(true)}
              >
                Renvoyer
              </Button>
              {canMarkEmailSent ? (
                <>
                  <Input
                    type="text"
                    size="sm"
                    className="h-7 w-full max-w-56 text-xs"
                    placeholder="Identifiant du message fournisseur"
                    aria-label="Identifiant du message chez le fournisseur email"
                    value={providerMessageId}
                    disabled={isPending}
                    onChange={(event) => setProviderMessageId(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isPending || providerMessageId.trim().length === 0}
                    onClick={() => void handleMarkEmailSent()}
                  >
                    Marquer envoyé
                  </Button>
                </>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {showEmailButton && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={() => setSendModalOpen(true)}
            leftIcon={SEND_ICON}
          >
            {currentStatus === "draft"
              ? "Envoyer par email"
              : currentStatus === "sending"
                ? "Reprendre l’envoi"
                : "Renvoyer par email"}
          </Button>
        )}
        {transitions.map((transition) => (
          <Button
            key={transition.nextStatus}
            type="button"
            variant="outline"
            size="sm"
            loading={isPending}
            onClick={() => void handleStatusChange(transition.nextStatus)}
          >
            {transition.label}
          </Button>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <SendEstimateModal
        open={sendModalOpen}
        onClose={() => setSendModalOpen(false)}
        versionId={versionId}
        defaultSubject={defaultSubject}
        defaultRecipient={clientEmail}
        onSent={() => router.refresh()}
      />
    </>
  );
}
