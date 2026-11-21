import { EstimateApiError, toErrorMessage, extractErrorDetails, extractErrorCode } from "@/lib/estimates/client-errors";
import { readJson, extractFilenameFromContentDisposition } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import { downloadBlob } from "@/lib/browser-download";
import type { EstimateApprovalDecisionFilter, EstimateApprovalDecisionJournal } from "@/lib/estimates/approval-decision-journal";
import type { EstimateExportResult } from "@/lib/estimates/export-client";

function buildApprovalJournalQuery(input?: {
  authorUserId?: string | null;
  decision?: EstimateApprovalDecisionFilter | null;
  format?: "json" | "csv";
}) {
  const searchParams = new URLSearchParams();

  if (input?.authorUserId) {
    searchParams.set("author", input.authorUserId);
  }

  if (input?.decision) {
    searchParams.set("status", input.decision);
  }

  if (input?.format) {
    searchParams.set("format", input.format);
  }

  const query = searchParams.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function fetchEstimateApprovalDecisionJournal(
  versionId: string,
  filters?: {
    authorUserId?: string | null;
    decision?: EstimateApprovalDecisionFilter | null;
  }
): Promise<EstimateApprovalDecisionJournal> {
  const { parseEstimateApprovalDecisionJournal } = await import("@/lib/estimates/approval-journal-contracts");
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/approval-journal${buildApprovalJournalQuery(filters)}`,
    {
      method: "GET",
    },
    "Impossible de charger le journal de décision."
  );

  const parsed = parseEstimateApprovalDecisionJournal(payload);
  if (!parsed) {
    throw new Error("Réponse journal d'approbation invalide.");
  }

  return parsed;
}

export async function downloadEstimateApprovalDecisionJournalCsv(
  versionId: string,
  filters?: {
    authorUserId?: string | null;
    decision?: EstimateApprovalDecisionFilter | null;
  }
): Promise<EstimateExportResult> {
  const response = await fetch(
    `/api/estimates/${versionId}/approval-journal${buildApprovalJournalQuery({
      ...filters,
      format: "csv",
    })}`,
    {
      method: "GET",
      credentials: "same-origin",
    }
  );

  if (!response.ok) {
    const payload = await readJson(response);
    throw new EstimateApiError(
      toErrorMessage(payload, "Impossible d'exporter le journal de décision."),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  const blob = await response.blob();
  const filename =
    extractFilenameFromContentDisposition(
      response.headers.get("Content-Disposition")
    ) ?? `approval-journal-${versionId}.csv`;

  downloadBlob(blob, filename);

  return {
    filename,
    size: blob.size,
  };
}
