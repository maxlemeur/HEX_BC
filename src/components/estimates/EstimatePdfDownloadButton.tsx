"use client";

import { useCallback, useState } from "react";

import { EstimatePdfLayoutModal } from "@/components/estimates/EstimatePdfLayoutModal";
import {
  fetchEstimatePdfStatus,
  requestEstimatePdfGeneration,
} from "@/lib/estimates/client";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

type EstimatePdfDownloadButtonProps = {
  versionId: string;
  className?: string;
  label?: string;
  processingLabel?: string;
  showInlineError?: boolean;
  onSuccess?: (downloadUrl: string) => void;
  onError?: (message: string) => void;
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

function toSafeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) return message;
  }
  return "Echec generation PDF";
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
  className,
  label = "Telecharger PDF",
  processingLabel = "Generation PDF...",
  showInlineError = true,
  onSuccess,
  onError,
}: Readonly<EstimatePdfDownloadButtonProps>) {
  const [layoutModalOpen, setLayoutModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollUntilReady = useCallback(async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const status = await fetchEstimatePdfStatus(versionId);

      if (status.status === "ready" && status.downloadUrl) {
        return status.downloadUrl;
      }
      if (status.status === "failed") {
        throw new Error(status.lastError ?? "Echec generation PDF");
      }
      await wait(POLL_INTERVAL_MS);
    }

    throw new Error("Echec generation PDF");
  }, [versionId]);

  const handleGenerate = useCallback(
    async (layout: EstimatePdfLayoutOptions) => {
      if (isProcessing) return;

      setIsProcessing(true);
      setErrorMessage(null);
      try {
        const initial = await requestEstimatePdfGeneration(versionId, {
          force: true,
          layout,
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
    [isProcessing, onError, onSuccess, pollUntilReady, versionId]
  );

  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        className={className ?? "btn btn-secondary btn-sm"}
        type="button"
        onClick={() => setLayoutModalOpen(true)}
        disabled={isProcessing}
      >
        {isProcessing ? processingLabel : label}
      </button>
      {showInlineError && errorMessage ? (
        <p className="text-xs font-medium text-[var(--danger-700)]" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <EstimatePdfLayoutModal
        open={layoutModalOpen}
        onOpenChange={setLayoutModalOpen}
        versionId={versionId}
        confirmLabel="Générer et télécharger"
        onConfirm={handleGenerate}
      />
    </div>
  );
}
