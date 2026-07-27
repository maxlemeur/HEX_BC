"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { AcceptEstimateModal } from "@/components/portal/AcceptEstimateModal";
import { RejectEstimateModal } from "@/components/portal/RejectEstimateModal";

type PortalActionsProps = {
  token: string;
  status: "pending" | "accepted" | "rejected" | "expired";
  totalTtcFormatted?: string;
  projectReference?: string | null;
};

function PortalPrintButton({ className = "" }: Readonly<{ className?: string }>) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--slate-200)] bg-white px-6 py-3 text-sm font-semibold text-[var(--slate-700)] transition-colors hover:bg-[var(--slate-50)] ${className}`}
      onClick={() => window.print()}
    >
      Imprimer / Enregistrer en PDF
    </button>
  );
}

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

  if (status === "accepted") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#059669"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm font-medium text-emerald-800">
              Ce devis a été accepté. Merci pour votre confiance.
            </p>
          </div>
        </div>
        <div className="flex justify-end print:hidden">
          <PortalPrintButton />
        </div>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--slate-200)]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--slate-500)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m15 9-6 6" />
                <path d="m9 9 6 6" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--slate-600)]">
              Ce devis a été refusé.
            </p>
          </div>
        </div>
        <div className="flex justify-end print:hidden">
          <PortalPrintButton />
        </div>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#d97706"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className="text-sm font-medium text-amber-800">
            Ce devis a expiré. Veuillez contacter votre interlocuteur.
          </p>
        </div>
      </div>
    );
  }

  // status === "pending"
  return (
    <>
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:justify-end">
        {/*
          UX-D : le client n avait aucun moyen de conserver une trace de ce
          qu il signe. L impression navigateur produit une copie fidele du
          document affiche — qui est desormais celui du PDF envoye, mise en
          page et CGV comprises.
        */}
        <PortalPrintButton className="sm:mr-auto" />
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-6 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
          onClick={() => setRejectModalOpen(true)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          Refuser le devis
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          onClick={() => setAcceptModalOpen(true)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Accepter le devis
        </button>
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
