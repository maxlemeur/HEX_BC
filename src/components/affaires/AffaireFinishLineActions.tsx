"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import { exportEstimate } from "@/lib/estimates/client";
import type { EstimateStatus } from "@/lib/estimates/status";
import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";
import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui-legacy/Toast";
import {
  describeSubmissionReadinessGroup,
  isPdfFinishLineFlag,
  resolveSubmissionReadiness,
} from "./AffairePilotagePanel.logic";
import { ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AffaireFinishLineActionsProps = {
  projectId: string;
  projectName: string;
  currentVersion:
    | {
        id: string;
        status: EstimateStatus;
        versionNumber: number;
        updatedAt?: string;
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
      return "Envoyée";
    case "accepted":
      return "Acceptée";
    case "archived":
      return "Archivée";
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
      note: "Un envoi est déjà réservé. Reprenez-le avec les mêmes données pour terminer la livraison sans créer de doublon.",
      disabled: false,
    };
  }

  if (currentVersion && !canSendEstimateByEmail(currentVersion)) {
    return {
      status: "unavailable" as const,
      note: `L'envoi par email reste réservé aux versions brouillon ou envoyées. Cette version est ${formatVersionStatus(currentVersion.status).toLowerCase()}.`,
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
      note: "Le mail joint le PDF de la version visible ici. Une confirmation explicite reste demandée.",
      disabled: false,
    };
  }

  if (submissionReadiness.status === "warning") {
    return {
      status: "warning" as const,
      note: `${submissionReadiness.alerts.length} point${submissionReadiness.alerts.length > 1 ? "s" : ""} reste${submissionReadiness.alerts.length > 1 ? "nt" : ""} à vérifier avant l'envoi final.`,
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
        ? "Générez d'abord le PDF ici, puis préparez l'email depuis la même zone."
        : `${submissionReadiness.blockers.length} blocage${submissionReadiness.blockers.length > 1 ? "s" : ""} visible${submissionReadiness.blockers.length > 1 ? "s" : ""} juste au-dessus avant l'envoi.`,
      disabled: true,
    };
  }

  return {
    status: "unavailable" as const,
    note:
      submissionReadiness.errorMessage ??
      "Les préconditions d'envoi sont indisponibles pour le moment.",
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
  const [isRefreshingPdf, startPdfRefresh] = useTransition();
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
        title: "BDC exporté",
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
      className="mt-4 rounded-2xl border border-border bg-surface-subtle/70 p-4 scroll-mt-24"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Documents et envoi
          </p>
        </div>
        <Badge
          variant={
            sendActionState.status === "ready"
              ? "success"
              : sendActionState.status === "warning"
                ? "warning"
                : sendActionState.status === "blocked"
                  ? "danger"
                  : "info"
          }
          dot
          className="self-start"
        >
          {currentVersion
            ? `${formatVersionLabel(currentVersion)} · ${formatVersionStatus(currentVersion.status)}`
            : "Aucune version"}
        </Badge>
      </div>

      {!currentVersion ? (
        <div className="mt-4 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Créez d&apos;abord une version de devis pour centraliser la sortie client.
          </p>
          <Link
            href={`/dashboard/estimates/new?projectId=${projectId}`}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-brand-blue-dark"
          >
            Créer un devis
            <ArrowRightIcon aria-hidden="true" size={14} />
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            <article className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm font-semibold text-foreground">PDF du devis</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {currentVersion.status === "draft"
                  ? `Préparez le PDF de la ${formatVersionLabel(currentVersion).toLowerCase()}, puis téléchargez-le une fois prêt.`
                  : `Téléchargez le PDF original de la ${formatVersionLabel(currentVersion).toLowerCase()} lorsqu’il est disponible.`}
              </p>
              <div className="mt-4" data-testid="affaire-finish-line-pdf">
                <EstimatePdfDownloadButton
                  versionId={currentVersion.id}
                  versionStatus={currentVersion.status}
                  // Layout-only: a className already selects the outline/md button; self-start keeps
                  // the auto width of its neighbours instead of stretching across the column.
                  className="self-start"
                  label="Préparer le PDF"
                  processingLabel="Génération du PDF…"
                  showInlineError={false}
                  onSuccess={() => {
                    const successMessage = `PDF prêt pour la version V${currentVersion.versionNumber}.`;
                    setPdfFeedback({ tone: "success", message: successMessage });
                    toast.success({
                      title: "PDF prêt",
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
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-brand-blue-dark"
              >
                Voir la version imprimable
                <ArrowRightIcon aria-hidden="true" size={14} />
              </Link>
              {pdfFeedback ? (
                <p
                  className={`mt-3 text-xs font-medium ${
                    pdfFeedback.tone === "error"
                      ? "text-danger"
                      : "text-success"
                  }`}
                >
                  {pdfFeedback.message}
                </p>
              ) : null}
            </article>

            <article className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  Email client
                </p>
                <Badge
                  variant={
                    sendActionState.status === "ready"
                      ? "success"
                      : sendActionState.status === "warning"
                        ? "warning"
                        : sendActionState.status === "blocked"
                          ? "danger"
                          : "neutral"
                  }
                  dot
                >
                  {sendActionState.status === "ready"
                    ? "Prêt"
                    : sendActionState.status === "warning"
                      ? "À assumer"
                      : sendActionState.status === "blocked"
                        ? "À lever"
                        : "En attente"}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {sendActionState.note}
              </p>
              {submissionReadinessGroups.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Catégories de blocage pré-remise">
                  {submissionReadinessGroups.map((group) => (
                    <li key={group.category}>
                      <Badge
                        variant={group.blockerCount > 0 ? "danger" : "warning"}
                        dot
                        className="h-auto min-h-6 whitespace-normal py-0.5"
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
                  className={buttonVariants({ variant: "primary", size: "md" })}
                  onClick={() => setSendModalOpen(true)}
                  disabled={sendActionState.disabled || isRefreshingPdf}
                >
                  {currentVersion.status === "sending"
                    ? "Reprendre l'envoi"
                    : "Préparer l'envoi"}
                </button>
              </div>
            </article>

            <article className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm font-semibold text-foreground">
                Export BDC
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Exporte la {formatVersionLabel(currentVersion).toLowerCase()} en BDC V1.1 sans quitter
                l&apos;affaire.
              </p>
              <div className="mt-4" data-testid="affaire-finish-line-bdc">
                <button
                  type="button"
                  className={cn(buttonVariants({ variant: "outline", size: "md" }))}
                  onClick={() => void handleExportBdc()}
                  disabled={isExportingBdc}
                >
                  {isExportingBdc ? "Export du BDC…" : "Exporter le BDC"}
                </button>
              </div>
              {bdcError ? (
                <p className="mt-3 text-xs font-medium text-danger" role="alert">
                  {bdcError}
                </p>
              ) : null}
            </article>
          </div>

          <SendEstimateModal
            open={sendModalOpen}
            onClose={() => setSendModalOpen(false)}
            versionId={currentVersion.id}
            versionStatus={currentVersion.status}
            versionUpdatedAt={currentVersion.updatedAt}
            defaultSubject={defaultSubject}
            onPdfPrepared={() => startPdfRefresh(() => router.refresh())}
            onSent={() => {
              setSendModalOpen(false);
              router.refresh();
            }}
          />

        </>
      )}
    </div>
  );
}
