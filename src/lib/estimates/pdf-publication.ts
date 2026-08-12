import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  type SupabaseErrorLike,
} from "@/lib/estimates/errors";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import type { Database, Json } from "@/types/database";

type EstimateDocumentRow =
  Database["public"]["Tables"]["estimate_documents"]["Row"];

export type EstimatePdfGenerationPurpose = "manual" | "email" | "workflow";

export type EstimatePdfGenerationClaim = {
  token: string;
  purpose: EstimatePdfGenerationPurpose;
  dispatchId: string | null;
  contentRevision: number;
};

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function throwPdfPublicationError(
  error: SupabaseErrorLike,
  fallbackMessage: string,
): never {
  const message = error.message ?? "";

  if (
    message.includes("ESTIMATE_PDF_GENERATION_SUPERSEDED") ||
    message.includes("ESTIMATE_PDF_EMAIL_STATE_CONFLICT") ||
    message.includes("ESTIMATE_EMAIL_PDF_PUBLICATION_CONFLICT")
  ) {
    throw conflict(
      "Cette generation PDF a ete remplacee par un workflow plus recent.",
      { code: error.code },
      "ESTIMATE_PDF_GENERATION_SUPERSEDED",
    );
  }

  if (
    message.includes("SERVICE_ROLE_REQUIRED") ||
    message.includes("STATUS_FORBIDDEN")
  ) {
    throw forbidden(
      "La publication de ce PDF n'est plus autorisee.",
      { code: error.code },
      "ESTIMATE_PDF_CONTRACT_IMMUTABLE",
    );
  }

  if (message.includes("NOT_FOUND")) {
    throw notFound(
      "Version ou tentative de generation PDF introuvable.",
      { code: error.code },
      "ESTIMATE_PDF_GENERATION_NOT_FOUND",
    );
  }

  if (
    message.includes("PURPOSE_INVALID") ||
    message.includes("PUBLICATION_INVALID") ||
    message.includes("PATH_INVALID") ||
    message.includes("HASH_INVALID")
  ) {
    throw badRequest(
      fallbackMessage,
      { code: error.code },
      "ESTIMATE_PDF_PUBLICATION_INVALID",
    );
  }

  throw mapSupabaseError(error, fallbackMessage);
}

function parseGenerationClaim(data: unknown): EstimatePdfGenerationClaim {
  if (!data || typeof data !== "object") {
    throw badRequest(
      "La base a renvoye une tentative PDF incomplete.",
      undefined,
      "ESTIMATE_PDF_GENERATION_INVALID_RESPONSE",
    );
  }

  const row = data as Partial<EstimateDocumentRow>;
  if (
    typeof row.generation_token !== "string" ||
    !["manual", "email", "workflow"].includes(
      String(row.generation_purpose),
    ) ||
    typeof row.generation_content_revision !== "number"
  ) {
    throw badRequest(
      "La base a renvoye une tentative PDF incomplete.",
      undefined,
      "ESTIMATE_PDF_GENERATION_INVALID_RESPONSE",
    );
  }

  return {
    token: row.generation_token,
    purpose: row.generation_purpose as EstimatePdfGenerationPurpose,
    dispatchId: row.generation_dispatch_id ?? null,
    contentRevision: row.generation_content_revision,
  };
}

export async function beginEstimatePdfGeneration(input: {
  client: ServerSupabaseClient;
  versionId: string;
  tenantId: string;
  actorUserId: string;
  purpose: EstimatePdfGenerationPurpose;
  dispatchId?: string | null;
}) {
  const { data, error } = await input.client.rpc(
    "begin_estimate_pdf_generation",
    {
      p_version_id: input.versionId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_purpose: input.purpose,
      p_dispatch_id: input.dispatchId ?? null,
    },
  );

  if (error) {
    throwPdfPublicationError(error, "Impossible de demarrer la generation PDF.");
  }

  return parseGenerationClaim(data);
}

export async function publishEstimatePdfGeneration(input: {
  client: ServerSupabaseClient;
  versionId: string;
  tenantId: string;
  actorUserId: string;
  claim: EstimatePdfGenerationClaim;
  filePath: string;
  sha256Hash: string;
  fileSizeBytes: number;
  generatedAt: string;
  layoutOptions: Json;
  termsSnapshot: Json | null;
}) {
  const { data, error } = await input.client.rpc(
    "publish_estimate_pdf_generation",
    {
      p_version_id: input.versionId,
      p_tenant_id: input.tenantId,
      p_actor_user_id: input.actorUserId,
      p_generation_token: input.claim.token,
      p_file_path: input.filePath,
      p_sha256_hash: input.sha256Hash,
      p_file_size_bytes: input.fileSizeBytes,
      p_generated_at: input.generatedAt,
      p_layout_options: input.layoutOptions,
      p_terms_snapshot: input.termsSnapshot,
    },
  );

  if (error) {
    throwPdfPublicationError(error, "Impossible de publier le document PDF.");
  }

  return data as EstimateDocumentRow;
}

export async function failEstimatePdfGeneration(input: {
  client: ServerSupabaseClient;
  versionId: string;
  tenantId: string;
  actorUserId: string;
  claim: EstimatePdfGenerationClaim;
  message: string;
}) {
  const { data, error } = await input.client.rpc("fail_estimate_pdf_generation", {
    p_version_id: input.versionId,
    p_tenant_id: input.tenantId,
    p_actor_user_id: input.actorUserId,
    p_generation_token: input.claim.token,
    p_error_message: input.message,
  });

  if (error) {
    throwPdfPublicationError(error, "Impossible de cloturer la generation PDF.");
  }

  return data as EstimateDocumentRow;
}

export function buildContentAddressedEstimatePdfPath(input: {
  tenantId: string;
  projectId: string;
  versionId: string;
  sha256Hash: string;
}) {
  const sha256Hash = input.sha256Hash.toLowerCase();
  if (!SHA256_PATTERN.test(sha256Hash)) {
    throw new Error("Invalid estimate PDF SHA-256 hash.");
  }

  return [
    input.tenantId,
    input.projectId,
    input.versionId,
    `${sha256Hash}.pdf`,
  ].join("/");
}

export function buildLegacyEstimatePdfPath(input: {
  tenantId: string;
  projectId: string;
  versionId: string;
}) {
  return `${input.tenantId}/${input.projectId}/${input.versionId}.pdf`;
}

export function isCanonicalEstimatePdfPath(input: {
  filePath: string;
  tenantId: string;
  projectId: string;
  versionId: string;
  sha256Hash?: string | null;
}) {
  const legacyPrefix = `${input.tenantId}/${input.projectId}/`;
  const legacyFilename = input.filePath.startsWith(legacyPrefix)
    ? input.filePath.slice(legacyPrefix.length)
    : "";
  if (
    legacyFilename.length > ".pdf".length &&
    !legacyFilename.includes("/") &&
    legacyFilename.endsWith(".pdf")
  ) {
    return true;
  }

  const sha256Hash = input.sha256Hash?.toLowerCase();
  return Boolean(
    sha256Hash &&
      SHA256_PATTERN.test(sha256Hash) &&
      input.filePath ===
        buildContentAddressedEstimatePdfPath({
          tenantId: input.tenantId,
          projectId: input.projectId,
          versionId: input.versionId,
          sha256Hash,
        }),
  );
}

export function isImmutableStorageObjectAlreadyPresent(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    status?: number;
    statusCode?: number | string;
    error?: string;
    message?: string;
  };
  const status = Number(candidate.status ?? candidate.statusCode ?? 0);
  const message = `${candidate.error ?? ""} ${candidate.message ?? ""}`.toLowerCase();
  return (
    (status === 400 || status === 409) &&
    (message.includes("already exists") || message.includes("duplicate"))
  );
}
