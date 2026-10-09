"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { FileDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  fetchEstimatePdfStatus,
  requestEstimatePdfGeneration,
} from "@/lib/estimates/client";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

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
  className,
  label = "Préparer le PDF",
  processingLabel = "Génération du PDF…",
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
      <Button
        // Without a className the trigger is styled as an item of an actions menu.
        className={className ?? "w-full justify-start"}
        variant={className ? "outline" : "ghost"}
        size="md"
        type="button"
        onClick={() => setLayoutModalOpen(true)}
        disabled={isProcessing}
        aria-busy={isProcessing || undefined}
        leftIcon={<FileDownIcon aria-hidden="true" />}
      >
        {isProcessing ? processingLabel : label}
      </Button>
      {showInlineError && errorMessage ? (
        <p className="text-xs font-medium text-danger" role="alert">
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
