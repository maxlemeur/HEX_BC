"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CircleXIcon, PrinterIcon } from "lucide-react";

import { AcceptEstimateModal } from "@/components/portal/AcceptEstimateModal";
import { RejectEstimateModal } from "@/components/portal/RejectEstimateModal";
import { Button } from "@/components/ui/button";

type PortalActionsProps = {
  token: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  totalTtcFormatted?: string;
  projectReference?: string | null;
};

/**
 * UX-D : le client n'avait aucun moyen de conserver une trace de ce qu'il signe.
 * L'impression navigateur produit une copie fidèle du document affiché — qui est
 * celui du PDF envoyé, mise en page et CGV comprises.
 */
function PortalPrintButton({ className }: Readonly<{ className?: string }>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className={className}
      leftIcon={<PrinterIcon aria-hidden="true" />}
      onClick={() => window.print()}
    >
      Imprimer / Enregistrer en PDF
    </Button>
  );
}

/**
 * Actions du portail. Le statut de décision (accepté, refusé, expiré) est
 * affiché une seule fois, dans l'en-tête (UX73) : ce bloc ne porte que les
 * actions. Tant que le devis est en attente, Accepter / Refuser restent
 * accessibles en bas de l'écran sur mobile pendant la lecture du document.
 */
export function PortalActions({
  token,
  status,
  totalTtcFormatted,
  projectReference,
}: PortalActionsProps) {
  const router = useRouter();
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [acceptModalOpen, setAcceptModalOpen] = useState(false);

  const handleRejected = useCallback(() => {
    setRejectModalOpen(false);
    router.refresh();
  }, [router]);

  const handleAccepted = useCallback(() => {
    setAcceptModalOpen(false);
    router.refresh();
  }, [router]);

  if (status === "expired") {
    return null;
  }

  if (status !== "pending") {
    return (
      <div className="flex justify-end print:hidden">
        <PortalPrintButton className="w-full sm:w-auto" />
      </div>
    );
  }

  return (
    <>
      {/* Mobile : l'impression reste dans le flux, au-dessus de la barre de réponse. */}
      <div className="print:hidden sm:hidden">
        <PortalPrintButton className="w-full" />
      </div>
      {/*
        Rendu au même niveau que l'en-tête et le document : `sticky` reste alors
        visible en bas de l'écran pendant tout le défilement du devis.
      */}
      <div
        className="sticky bottom-0 z-10 -mx-4 grid grid-cols-2 gap-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_-6px_rgb(15_23_42/0.15)] print:hidden sm:static sm:mx-0 sm:flex sm:justify-end sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"
      >
        <PortalPrintButton className="hidden sm:mr-auto sm:inline-flex" />
        <Button
          type="button"
          variant="danger"
          size="lg"
          leftIcon={<CircleXIcon aria-hidden="true" />}
          onClick={() => setRejectModalOpen(true)}
        >
          Refuser<span className="hidden sm:inline">&nbsp;le devis</span>
        </Button>
        <Button
          type="button"
          size="lg"
          className="bg-success text-success-foreground shadow-none hover:bg-success/90"
          leftIcon={<CheckIcon aria-hidden="true" />}
          onClick={() => setAcceptModalOpen(true)}
        >
          Accepter<span className="hidden sm:inline">&nbsp;le devis</span>
        </Button>
      </div>
      <RejectEstimateModal
        open={rejectModalOpen}
        onClose={() => setRejectModalOpen(false)}
        token={token}
        onRejected={handleRejected}
      />
      <AcceptEstimateModal
        open={acceptModalOpen}
        onClose={() => setAcceptModalOpen(false)}
        token={token}
        onAccepted={handleAccepted}
        totalTtcFormatted={totalTtcFormatted}
        projectReference={projectReference}
      />
    </>
  );
}
