import { EstimateApiError, toErrorMessage, extractErrorDetails, extractErrorCode } from "@/lib/estimates/client-errors";
import { readJson, extractFilenameFromContentDisposition } from "@/lib/estimates/client-http";
import { downloadBlob } from "@/lib/browser-download";

export type EstimateExportResult = {
  filename: string;
  size: number;
};

export type EstimateExportMode = "standard" | "dpgf" | "bdc";

export async function exportEstimate(
  versionId: string,
  /** csv : CSV d'une v3 écrit par le serveur (sous-lot 2.7b) ; celui d'une v1/v2 reste construit par l'éditeur. */
  format: "xlsx" | "csv" = "xlsx",
  options: {
    mode?: EstimateExportMode;
  } = {}
): Promise<EstimateExportResult> {
  const queryParams = new URLSearchParams({
    format,
  });
  if (typeof options.mode === "string") {
    queryParams.set("mode", options.mode);
  }

  const response = await fetch(`/api/estimates/${versionId}/export?${queryParams.toString()}`, {
    method: "GET",
    credentials: "same-origin",
  });

  if (!response.ok) {
    const payload = await readJson(response);
    throw new EstimateApiError(
      toErrorMessage(payload, "Impossible d'exporter le devis."),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  const blob = await response.blob();
  const filename =
    extractFilenameFromContentDisposition(
      response.headers.get("content-disposition")
    ) ?? `devis-${versionId}.${format}`;

  downloadBlob(blob, filename);

  return {
    filename,
    size: blob.size,
  };
}
