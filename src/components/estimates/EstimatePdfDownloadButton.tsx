"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { FileDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  fetchEstimatePdfStatus,
  requestEstimatePdfGeneration,
  type EstimateEditorData,
} from "@/lib/estimates/client";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import type { EstimateStatus } from "@/lib/estimates/status";

// The layout dialog only opens on click: keep it out of the bundles of the pages showing the button.
const EstimatePdfLayoutModal = dynamic(
  () =>
    import("@/components/estimates/EstimatePdfLayoutModal").then((module) => ({
      default: module.EstimatePdfLayoutModal,
    })),
  { ssr: false, loading: () => null }
);

type EstimatePdfDownloadButtonProps = {
  versionId: string;
  versionStatus: EstimateStatus;
  className?: string;
  label?: string;
  processingLabel?: string;
  showInlineError?: boolean;
  onSuccess?: (downloadUrl: string) => void;
  onError?: (message: string) => void;
  onBeforeGenerate?: () => Promise<boolean>;
  onPrepared?: (data: EstimateEditorData) => void;
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) return message;
  }
  return "Échec de la génération du PDF";
}

function openDownload(url: string) {
  if (typeof window === "undefined") return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function EstimatePdfDownloadButton({
  versionId,
  versionStatus,
  className,
  label = "Préparer le PDF",
  processingLabel = "Génération du PDF…",
  showInlineError = true,
  onSuccess,
  onError,
  onBeforeGenerate,
  onPrepared,
}: Readonly<EstimatePdfDownloadButtonProps>) {
  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requiresDraftLock = versionStatus === "draft";

  const handleDownloadExisting = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const status = await fetchEstimatePdfStatus(versionId);
      if (status.status !== "ready" || !status.downloadUrl) {
        throw new Error("Le PDF original de ce devis n’est pas disponible.");
      }
      openDownload(status.downloadUrl);
      onSuccess?.(status.downloadUrl);
    } catch (error) {
      const message = toSafeErrorMessage(error);
      setErrorMessage(message);
      onError?.(message);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, onError, onSuccess, versionId]);

  const pollUntilReady = useCallback(async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const status = await fetchEstimatePdfStatus(versionId);

      if (status.status === "ready" && status.downloadUrl) {
        return status.downloadUrl;
      }
      if (status.status === "failed") {
        throw new Error(status.lastError ?? "Échec de la génération du PDF");
      }
      await wait(POLL_INTERVAL_MS);
    }

    throw new Error("Échec de la génération du PDF");
  }, [versionId]);

  const handleGenerate = useCallback(
    async (layout: EstimatePdfLayoutOptions) => {
      if (isProcessing) return;

      setIsProcessing(true);
      setErrorMessage(null);
      try {
        if (onBeforeGenerate && !(await onBeforeGenerate())) {
          throw new Error("Synchronisez les modifications du devis avant de préparer le PDF.");
        }
        const initial = await requestEstimatePdfGeneration(versionId, {
          force: true,
          layout,
          onPrepared: (data) => { onPrepared?.(data); setErrorMessage(null); },
        });
        const downloadUrl =
          initial.status === "ready" && initial.downloadUrl
            ? initial.downloadUrl
            : await pollUntilReady();

        openDownload(downloadUrl);
        onSuccess?.(downloadUrl);
      } catch (error) {
        const message = toSafeErrorMessage(error);
        setErrorMessage(message);
        onError?.(message);
        throw error;
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, onBeforeGenerate, onError, onPrepared, onSuccess, pollUntilReady, versionId]
  );

  return (
    <div className="flex flex-col items-stretch gap-2">
      <Button
        // Without a className the trigger is styled as an item of an actions menu.
        className={className ?? "w-full justify-start"}
        variant={className ? "outline" : "ghost"}
        size="md"
        type="button"
        onClick={() => {
          if (requiresDraftLock) setLayoutModalOpen(true);
          else void handleDownloadExisting();
        }}
        disabled={isProcessing}
        aria-busy={isProcessing || undefined}
        leftIcon={<FileDownIcon aria-hidden="true" />}
      >
        {isProcessing ? (requiresDraftLock ? processingLabel : "Téléchargement…") : (requiresDraftLock ? label : "Télécharger le PDF")}
      </Button>
      {showInlineError && errorMessage ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <EstimatePdfLayoutModal
        open={requiresDraftLock && layoutModalOpen}
        onOpenChange={setLayoutModalOpen}
        versionId={versionId}
        requiresDraftLock={requiresDraftLock}
        confirmLabel="Générer et télécharger"
        onConfirm={handleGenerate}
      />
    </div>
  );
}
