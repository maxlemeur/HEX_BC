import { toNumber, toBooleanValue, getRootPayload } from "@/lib/estimates/client-json";
import { EstimateApiError, isEstimateApiError, toErrorMessage, extractErrorDetails, extractErrorCode } from "@/lib/estimates/client-errors";
import { readJson, requestJsonUncoordinated, extractFilenameFromContentDisposition } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import { fetchEstimateEditorData } from "@/lib/estimates/editor-read-client";
import type { EstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { downloadBlob } from "@/lib/browser-download";
import { assertNoPendingEstimateBatch } from "@/lib/estimates/batch-intentions";
import { getEstimateEditorMutationIdentity, hasEstimateEditorMutationSession, runEstimateEditorMutation } from "@/lib/estimates/editor-mutations";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import { getEstimateDraftLockSessionId } from "@/lib/estimates/draft-lock-session-client";
import type { EstimatePdfLayoutConfiguration, EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import { isRecord, toNonEmptyString } from "@/lib/value-guards";

export type EstimatePdfStatus = "missing" | "processing" | "failed" | "ready";

export type EstimatePdfStatusResponse = {
  status: EstimatePdfStatus;
  downloadUrl?: string;
  filePath?: string;
  sha256Hash?: string;
  generatedAt?: string;
  fileSizeBytes?: number;
  lastError?: string;
};

export type EstimatePdfLayoutConfigurationResponse =
  EstimatePdfLayoutConfiguration;

function isEstimatePdfStatus(value: string): value is EstimatePdfStatus {
  return (
    value === "missing" ||
    value === "processing" ||
    value === "failed" ||
    value === "ready"
  );
}

function parseEstimatePdfStatus(payload: unknown): EstimatePdfStatusResponse | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const rawStatus = toNonEmptyString(root.status);
  if (!rawStatus || !isEstimatePdfStatus(rawStatus)) {
    return null;
  }

  return {
    status: rawStatus,
    downloadUrl:
      toNonEmptyString(root.download_url) ?? toNonEmptyString(root.downloadUrl) ?? undefined,
    filePath: toNonEmptyString(root.file_path) ?? toNonEmptyString(root.filePath) ?? undefined,
    sha256Hash:
      toNonEmptyString(root.sha256_hash) ?? toNonEmptyString(root.sha256Hash) ?? undefined,
    generatedAt:
      toNonEmptyString(root.generated_at) ?? toNonEmptyString(root.generatedAt) ?? undefined,
    fileSizeBytes:
      toNumber(root.file_size_bytes) ?? toNumber(root.fileSizeBytes) ?? undefined,
    lastError:
      toNonEmptyString(root.last_error) ?? toNonEmptyString(root.lastError) ?? undefined,
  };
}

function parseEstimatePdfLayoutConfiguration(
  payload: unknown
): EstimatePdfLayoutConfigurationResponse | null {
  const root = getRootPayload(payload);
  if (!isRecord(root) || !isRecord(root.sectionCountsByLevel) || !isRecord(root.terms)) {
    return null;
  }
  const lineCount = toNumber(root.lineCount);
  const hasConditions = toBooleanValue(root.hasConditions);
  const policy = toNonEmptyString(root.terms.policy);
  if (
    lineCount === null ||
    hasConditions === null ||
    (policy !== "optional" && policy !== "default" && policy !== "required")
  ) {
    return null;
  }

  return {
    lineCount: Math.max(0, Math.trunc(lineCount)),
    sectionCountsByLevel: {
      "1": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["1"]) ?? 0)),
      "2": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["2"]) ?? 0)),
      "3": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["3"]) ?? 0)),
      "4": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["4"]) ?? 0)),
    },
    hasConditions,
    terms: {
      available: toBooleanValue(root.terms.available) ?? false,
      policy,
      title: toNonEmptyString(root.terms.title),
      version: toNumber(root.terms.version),
    },
  };
}

export async function requestEstimatePdfGeneration(
  versionId: string,
  options: {
    force?: boolean;
    layout?: EstimatePdfLayoutOptions;
    onPrepared?: (data: EstimateEditorData) => void;
  } = {}
): Promise<EstimatePdfStatusResponse> {
  const query = new URLSearchParams();
  if (options.force) {
    query.set("force", "1");
  }

  const path = query.size > 0
    ? `/api/estimates/${versionId}/pdf?${query.toString()}`
    : `/api/estimates/${versionId}/pdf`;

  const request = async () => {
    const payload = await requestJsonUncoordinated<unknown>(
      path,
      {
        method: "POST",
        headers: {
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: getEstimateDraftLockSessionId(versionId),
          ...(options.layout ? { "Content-Type": "application/json" } : {}),
        },
        body: options.layout
          ? JSON.stringify({ layout: options.layout })
          : undefined,
      },
      "Impossible de lancer la generation du PDF."
    );

    const parsed = parseEstimatePdfStatus(payload);
    if (!parsed) {
      throw new Error("Impossible de lire le statut de generation du PDF.");
    }
    return parsed;
  };
  if (!hasEstimateEditorMutationSession(versionId)) return request();
  return runEstimateEditorMutation(versionId, undefined, async (_token, scope) => {
    const identity = getEstimateEditorMutationIdentity(versionId);
    if (identity) assertNoPendingEstimateBatch(identity);
    const value = await request();
    // The first document freeze changes the CAS token and line snapshots.
    // Reconcile both under the same queue before another editor save starts.
    const read = async () => {
      const currentIdentity = getEstimateEditorMutationIdentity(versionId);
      if (JSON.stringify(currentIdentity) !== JSON.stringify(identity)) throw new Error("Le compte ou le devis a changé. La lecture est annulée.");
      const refreshed = await fetchEstimateEditorData(versionId);
      if (!scope.isActive() || JSON.stringify(getEstimateEditorMutationIdentity(versionId)) !== JSON.stringify(identity)) {
        throw new Error("L'éditeur a changé. La lecture est annulée.");
      }
      if (refreshed.version.id !== versionId) throw new Error("La préparation reçue appartient à un autre devis.");
      options.onPrepared?.(refreshed);
      return { version: { id: refreshed.version.id, updated_at: refreshed.version.updated_at }, structural: false };
    };
    try { return { value, ...await read() }; }
    catch { throw scope.requireRead(read); }
  });
}

export async function fetchEstimatePdfLayoutConfiguration(
  versionId: string
): Promise<EstimatePdfLayoutConfigurationResponse> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/pdf/layout`,
    { method: "GET" },
    "Impossible de charger les options de mise en page du devis."
  );
  const parsed = parseEstimatePdfLayoutConfiguration(payload);
  if (!parsed) {
    throw new Error("Impossible de lire les options de mise en page du devis.");
  }
  return parsed;
}

/** Fetch the authorized binary before announcing success. Opening a popup after
 * asynchronous generation can be blocked even though the server job is ready. */
export async function downloadEstimatePdf(versionId: string): Promise<void> {
  const response = await fetch(`/api/estimates/${versionId}/pdf`, { credentials: "same-origin" });
  if (!response.ok) {
    const payload = await readJson(response);
    throw new EstimateApiError(
      toErrorMessage(payload, "Impossible de télécharger le PDF."), response.status,
      extractErrorDetails(payload), extractErrorCode(payload),
    );
  }
  const blob = await response.blob();
  if (await blob.slice(0, 5).text() !== "%PDF-") {
    throw new Error("Le fichier reçu n'est pas un PDF valide.");
  }
  downloadBlob(blob, extractFilenameFromContentDisposition(response.headers.get("content-disposition")) ?? `devis-${versionId}.pdf`);
}

export async function fetchEstimatePdfStatus(
  versionId: string
): Promise<EstimatePdfStatusResponse> {
  try {
    const payload = await requestJson<unknown>(
      `/api/estimates/${versionId}/pdf?format=json`,
      {
        method: "GET",
      },
      "Impossible de récupérer le statut du PDF."
    );

    const parsed = parseEstimatePdfStatus(payload);
    if (!parsed) {
      throw new Error("Impossible de lire le statut du PDF.");
    }

    return parsed;
  } catch (error) {
    if (
      isEstimateApiError(error) &&
      (error.code === "PDF_NOT_READY" || error.code === "PDF_GENERATION_FAILED")
    ) {
      const parsed = parseEstimatePdfStatus(error.details);
      if (parsed) {
        return parsed;
      }

      if (error.code === "PDF_GENERATION_FAILED") {
        return {
          status: "failed",
          lastError: error.message,
        };
      }

      return {
        status: "missing",
      };
    }

    throw error;
  }
}
