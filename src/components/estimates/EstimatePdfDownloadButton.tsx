"use client";

import { useCallback, useState } from "react";

import {
  fetchEstimatePdfStatus,
  requestEstimatePdfGeneration,
} from "@/lib/estimates/client";

type EstimatePdfDownloadButtonProps = {
  versionId: string;
  className?: string;
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
}: EstimatePdfDownloadButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollUntilReady = useCallback(async () => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const status = await fetchEstimatePdfStatus(versionId);

      if (status.status === "ready" && status.downloadUrl) {
        openDownload(status.downloadUrl);
        return;
      }

      if (status.status === "failed") {
        throw new Error(status.lastError ?? "Echec generation PDF");
      }

      await wait(POLL_INTERVAL_MS);
    }

    throw new Error("Echec generation PDF");
  }, [versionId]);

  const handleClick = useCallback(async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const initial = await requestEstimatePdfGeneration(versionId);

      if (initial.status === "ready" && initial.downloadUrl) {
        openDownload(initial.downloadUrl);
        return;
      }

      await pollUntilReady();
    } catch (error) {
      setErrorMessage(toSafeErrorMessage(error));
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, pollUntilReady, versionId]);

  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        className={className ?? "btn btn-secondary btn-sm"}
        type="button"
        onClick={() => void handleClick()}
        disabled={isProcessing}
      >
        {isProcessing ? "Generation PDF..." : "Telecharger PDF"}
      </button>
      {errorMessage ? (
        <p className="text-xs font-medium text-[var(--danger-700)]">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
