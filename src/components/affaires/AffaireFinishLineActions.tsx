"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import {
  exportEstimate,
  fetchEstimatePdfStatus,
  requestEstimatePdfGeneration,
} from "@/lib/estimates/client";
import { SendEstimateModal } from "@/components/estimates/SendEstimateModal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

type AffaireFinishLineActionsProps = {
  projectId: string;
  projectName: string;
  currentVersion:
    | {
        id: string;
        status: string;
        versionNumber: number;
      }
    | null;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
};

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 120_000;

type FeedbackState =
  | {
      tone: "success" | "error";
      message: string;
    }
  | null;

function wait(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function openDownload(url: string) {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
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

function toSafeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }

  return fallback;
}

function getSendActionState(
  finishLineSummary: AffaireFinishLineActionsProps["finishLineSummary"]
) {
  const send = finishLineSummary?.readyToSend ?? null;
  if (!send) {
    return {
      status: "waiting" as const,
      note: "Rechargez la page avant de lancer une sortie client.",
      disabled: true,
    };
  }

  if (send.status === "ready") {
    return {
      status: "ready" as const,
      note: "Le mail joint le PDF de la version visible ici. Une confirmation explicite reste demandee.",
      disabled: false,
    };
  }

  if (send.status === "warning") {
    return {
      status: "warning" as const,
      note: `${send.warningFlags.length} vigilance${send.warningFlags.length > 1 ? "s" : ""} reste${send.warningFlags.length > 1 ? "nt" : ""} a assumer avant l'envoi final.`,
      disabled: false,
    };
  }

  if (send.status === "blocked") {
    const hasOnlyPdfBlocker =
      send.blockingFlags.length > 0 &&
      send.blockingFlags.every((flag) => flag.key === "no_pdf_generated");

    return {
      status: "blocked" as const,
      note: hasOnlyPdfBlocker
        ? "Generez d'abord le PDF ici, puis preparez l'email depuis la meme zone."
        : `${send.blockingFlags.length} blocage${send.blockingFlags.length > 1 ? "s" : ""} visible${send.blockingFlags.length > 1 ? "s" : ""} juste au-dessus avant l'envoi.`,
      disabled: true,
    };
  }

  return {
    status: "unavailable" as const,
    note:
      send.errorMessage ??
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
  const [isPdfProcessing, setIsPdfProcessing] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState<FeedbackState>(null);
  const [isExportingBdc, setIsExportingBdc] = useState(false);
  const [bdcError, setBdcError] = useState<string | null>(null);
  const sendActionState = getSendActionState(finishLineSummary);
  const defaultSubject = useMemo(() => {
    if (!currentVersion) {
      return `Devis - ${projectName}`;
    }

    return `Devis - ${projectName} V${currentVersion.versionNumber}`;
  }, [currentVersion, projectName]);

  const pollPdfUntilReady = useCallback(async () => {
    if (!currentVersion) {
      throw new Error("Version de devis introuvable.");
    }

    const startedAt = Date.now();

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const status = await fetchEstimatePdfStatus(currentVersion.id);

      if (status.status === "ready" && status.downloadUrl) {
        return status.downloadUrl;
      }

      if (status.status === "failed") {
        throw new Error(status.lastError ?? "Impossible de generer le PDF.");
      }

      await wait(POLL_INTERVAL_MS);
    }

    throw new Error("Impossible de generer le PDF.");
  }, [currentVersion]);

  const handleGeneratePdf = useCallback(async () => {
    if (!currentVersion || isPdfProcessing) return;

    setIsPdfProcessing(true);
    setPdfFeedback(null);

    try {
      const initialStatus = await requestEstimatePdfGeneration(currentVersion.id, {
        force: true,
      });

      const downloadUrl =
        initialStatus.status === "ready" && initialStatus.downloadUrl
          ? initialStatus.downloadUrl
          : await pollPdfUntilReady();

      openDownload(downloadUrl);
      const successMessage = `PDF pret pour la version V${currentVersion.versionNumber}.`;
      setPdfFeedback({
        tone: "success",
        message: successMessage,
      });
      toast.success({
        title: "PDF pret",
        description: successMessage,
      });
      router.refresh();
    } catch (error) {
      setPdfFeedback({
        tone: "error",
        message: toSafeErrorMessage(error, "Impossible de generer le PDF."),
      });
    } finally {
      setIsPdfProcessing(false);
    }
  }, [
    currentVersion,
    isPdfProcessing,
    pollPdfUntilReady,
    router,
    toast,
  ]);

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
                Il est regenere si besoin au moment du telechargement.
              </p>
              <div className="mt-4" data-testid="affaire-finish-line-pdf">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void handleGeneratePdf()}
                  disabled={isPdfProcessing}
                >
                  {isPdfProcessing ? "Generation du PDF..." : "Telecharger le PDF"}
                </button>
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
              <div className="mt-4" data-testid="affaire-finish-line-email">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setSendModalOpen(true)}
                  disabled={sendActionState.disabled}
                >
                  Preparer l&apos;envoi
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
        </>
      )}
    </div>
  );
}
