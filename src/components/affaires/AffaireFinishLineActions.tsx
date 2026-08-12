"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { exportEstimate } from "@/lib/estimates/client";
import type { EstimateStatus } from "@/lib/estimates/status";
import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";
import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { AffaireOrderDraftsPanel } from "./AffaireOrderDraftsPanel";
import {
  describeSubmissionReadinessGroup,
  isPdfFinishLineFlag,
  resolveSubmissionReadiness,
} from "./AffairePilotagePanel.logic";

type AffaireFinishLineActionsProps = {
  projectId: string;
  projectName: string;
  currentVersion:
    | {
        id: string;
        status: EstimateStatus;
        versionNumber: number;
      }
    | null;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
};

type FeedbackState =
  | {
      tone: "success" | "error";
      message: string;
    }
  | null;

function canSendEstimateByEmail(
  currentVersion: AffaireFinishLineActionsProps["currentVersion"]
) {
  return (
    currentVersion !== null &&
    (currentVersion.status === "draft" ||
      currentVersion.status === "sending" ||
      currentVersion.status === "sent")
  );
}

function formatVersionLabel(
  currentVersion: NonNullable<AffaireFinishLineActionsProps["currentVersion"]>
) {
  return `Version ${currentVersion.versionNumber}`;
}

function formatVersionStatus(status: string) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sending":
      return "Envoi en cours";
    case "sent":
      return "Envoyee";
    case "accepted":
      return "Acceptee";
    case "archived":
      return "Archivee";
    default:
      return status;
  }
}

function getSendActionState(
  currentVersion: AffaireFinishLineActionsProps["currentVersion"],
  finishLineSummary: AffaireFinishLineActionsProps["finishLineSummary"]
) {
  if (currentVersion?.status === "sending") {
    return {
      status: "warning" as const,
      note: "Un envoi est deja reserve. Reprenez-le avec les memes donnees pour terminer la livraison sans creer de doublon.",
      disabled: false,
    };
  }

  if (currentVersion && !canSendEstimateByEmail(currentVersion)) {
    return {
      status: "unavailable" as const,
      note: `L'envoi email reste reserve aux versions brouillon ou envoyee. Cette version est ${formatVersionStatus(currentVersion.status).toLowerCase()}.`,
      disabled: true,
    };
  }

  const submissionReadiness = resolveSubmissionReadiness(finishLineSummary);
  if (!submissionReadiness) {
    return {
      status: "waiting" as const,
      note: "Rechargez la page avant de lancer une sortie client.",
      disabled: true,
    };
  }

  if (submissionReadiness.status === "ready") {
    return {
      status: "ready" as const,
      note: "Le mail joint le PDF de la version visible ici. Une confirmation explicite reste demandee.",
      disabled: false,
    };
  }

  if (submissionReadiness.status === "warning") {
    return {
      status: "warning" as const,
      note: `${submissionReadiness.alerts.length} point${submissionReadiness.alerts.length > 1 ? "s" : ""} reste${submissionReadiness.alerts.length > 1 ? "nt" : ""} a verifier avant l'envoi final.`,
      disabled: false,
    };
  }

  if (submissionReadiness.status === "blocked") {
    const hasOnlyPdfBlocker =
      submissionReadiness.blockers.length > 0 &&
      submissionReadiness.blockers.every((flag) => isPdfFinishLineFlag(flag));

    return {
      status: "blocked" as const,
      note: hasOnlyPdfBlocker
        ? "Generez d'abord le PDF ici, puis preparez l'email depuis la meme zone."
        : `${submissionReadiness.blockers.length} blocage${submissionReadiness.blockers.length > 1 ? "s" : ""} visible${submissionReadiness.blockers.length > 1 ? "s" : ""} juste au-dessus avant l'envoi.`,
      disabled: true,
    };
  }

  return {
    status: "unavailable" as const,
    note:
      submissionReadiness.errorMessage ??
      "Les preconditions d'envoi sont indisponibles pour le moment.",
    disabled: true,
  };
}

export function AffaireFinishLineActions({
  projectId,
  projectName,
  currentVersion,
  finishLineSummary,
}: Readonly<AffaireFinishLineActionsProps>) {
  const router = useRouter();
  const toast = useToast();
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState<FeedbackState>(null);
  const [isExportingBdc, setIsExportingBdc] = useState(false);
  const [bdcError, setBdcError] = useState<string | null>(null);
  const submissionReadiness = resolveSubmissionReadiness(finishLineSummary);
  const submissionReadinessGroups = submissionReadiness?.groups ?? [];
  const sendActionState = getSendActionState(currentVersion, finishLineSummary);
  const defaultSubject = useMemo(() => {
    if (!currentVersion) {
      return `Devis - ${projectName}`;
    }

    return `Devis - ${projectName} V${currentVersion.versionNumber}`;
  }, [currentVersion, projectName]);

  const handleExportBdc = useCallback(async () => {
    if (!currentVersion || isExportingBdc) return;

    setIsExportingBdc(true);
    setBdcError(null);

    try {
      const result = await exportEstimate(currentVersion.id, "xlsx", { mode: "bdc" });
      toast.success({
        title: "BDC exporte",
        description: result.filename,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Impossible d'exporter le BDC.";
      setBdcError(message);
      toast.error({
        title: "Export BDC indisponible",
        description: message,
      });
    } finally {
      setIsExportingBdc(false);
    }
  }, [currentVersion, isExportingBdc, toast]);

  return (
    <div
      id="finish-line-output"
      className="mt-4 rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 p-4 scroll-mt-24"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
            Sortie devis
          </p>
          <h3 className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
            PDF, email et BDC depuis le meme point
          </h3>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            La version a sortir reste explicite et chaque action garde son retour
            lisible dans l&apos;affaire.
          </p>
        </div>
        <Badge
          variant={
            sendActionState.status === "ready"
              ? "success"
              : sendActionState.status === "warning"
                ? "warning"
                : sendActionState.status === "blocked"
                  ? "error"
                  : "info"
          }
          size="sm"
          withDot
          className="self-start"
        >
          {currentVersion
            ? `${formatVersionLabel(currentVersion)} · ${formatVersionStatus(currentVersion.status)}`
            : "Aucune version"}
        </Badge>
      </div>

      {!currentVersion ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--slate-300)] bg-white px-4 py-4">
          <p className="text-sm text-[var(--slate-600)]">
            Creez d&apos;abord une version de devis pour centraliser la sortie client.
          </p>
          <Link
            href={`/dashboard/estimates/new?projectId=${projectId}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
          >
            Creer un devis
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-white px-4 py-3">
            <p className="text-sm text-[var(--slate-600)]">{sendActionState.note}</p>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            <article className="rounded-xl border border-[var(--slate-200)] bg-white p-4">
              <p className="text-sm font-semibold text-[var(--slate-800)]">PDF du devis</p>
              <p className="mt-2 text-sm leading-6 text-[var(--slate-600)]">
                Le document telecharge correspond a la {formatVersionLabel(currentVersion).toLowerCase()}.
                Il reutilise le PDF existant si disponible, puis le regenere seulement si besoin.
              </p>
              <div className="mt-4" data-testid="affaire-finish-line-pdf">
                <EstimatePdfDownloadButton
                  versionId={currentVersion.id}
                  className="btn btn-secondary btn-sm"
                  label="Telecharger le PDF"
                  processingLabel="Generation du PDF..."
                  showInlineError={false}
                  onSuccess={() => {
                    const successMessage = `PDF pret pour la version V${currentVersion.versionNumber}.`;
                    setPdfFeedback({ tone: "success", message: successMessage });
                    toast.success({
                      title: "PDF pret",
                      description: successMessage,
                    });
                    router.refresh();
                  }}
                  onError={(message) => {
                    setPdfFeedback({ tone: "error", message });
                  }}
                />
              </div>
              <Link
                href={`/dashboard/estimates/${currentVersion.id}/print`}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand-blue)] transition-colors hover:text-[var(--brand-blue-dark)]"
              >
                Voir la version imprimable
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
              {pdfFeedback ? (
                <p
                  className={`mt-3 text-xs font-medium ${
                    pdfFeedback.tone === "error"
                      ? "text-[var(--danger-700)]"
                      : "text-[var(--success)]"
                  }`}
                >
                  {pdfFeedback.message}
                </p>
              ) : null}
            </article>

            <article className="rounded-xl border border-[var(--slate-200)] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--slate-800)]">
                  Email client
                </p>
                <Badge
                  variant={
                    sendActionState.status === "ready"
                      ? "success"
                      : sendActionState.status === "warning"
                        ? "warning"
                        : sendActionState.status === "blocked"
                          ? "error"
                          : "neutral"
                  }
                  size="sm"
                  withDot
                >
                  {sendActionState.status === "ready"
                    ? "Pret"
                    : sendActionState.status === "warning"
                      ? "A assumer"
                      : sendActionState.status === "blocked"
                        ? "A lever"
                        : "En attente"}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--slate-600)]">
                {sendActionState.note}
              </p>
              {submissionReadinessGroups.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Categories de blocage pre-remise">
                  {submissionReadinessGroups.map((group) => (
                    <li key={group.category}>
                      <Badge
                        variant={group.blockerCount > 0 ? "error" : "warning"}
                        size="sm"
                        withDot
                      >
                        {describeSubmissionReadinessGroup(group)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4" data-testid="affaire-finish-line-email">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setSendModalOpen(true)}
                  disabled={sendActionState.disabled}
                >
                  {currentVersion.status === "sending"
                    ? "Reprendre l'envoi"
                    : "Preparer l'envoi"}
                </button>
              </div>
            </article>

            <article className="rounded-xl border border-[var(--slate-200)] bg-white p-4">
              <p className="text-sm font-semibold text-[var(--slate-800)]">
                Export BDC
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--slate-600)]">
                Exporte la {formatVersionLabel(currentVersion).toLowerCase()} en BDC V1.1 sans quitter
                l&apos;affaire.
              </p>
              <div className="mt-4" data-testid="affaire-finish-line-bdc">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleExportBdc()}
                  disabled={isExportingBdc}
                >
                  {isExportingBdc ? "Export du BDC..." : "Exporter le BDC"}
                </button>
              </div>
              {bdcError ? (
                <p className="mt-3 text-xs font-medium text-[var(--danger-700)]" role="alert">
                  {bdcError}
                </p>
              ) : null}
            </article>
          </div>

          <SendEstimateModal
            open={sendModalOpen}
            onClose={() => setSendModalOpen(false)}
            versionId={currentVersion.id}
            defaultSubject={defaultSubject}
            onSent={() => {
              setSendModalOpen(false);
              router.refresh();
            }}
          />

          <AffaireOrderDraftsPanel
            projectId={projectId}
            currentVersion={currentVersion}
            readyToOrder={finishLineSummary?.readyToOrder ?? null}
          />
        </>
      )}
    </div>
  );
}
