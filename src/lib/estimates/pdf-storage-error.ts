export type EstimatePdfStorageFailureReason =
  | "bucket_missing"
  | "server_auth_invalid"
  | "storage_unavailable";

export type EstimatePdfStorageOperation = "upload" | "sign";

type ErrorRecord = Record<string, unknown>;

function toErrorRecord(error: unknown): ErrorRecord | null {
  return error !== null && typeof error === "object"
    ? (error as ErrorRecord)
    : null;
}

function toStatusCode(error: ErrorRecord | null) {
  const rawStatus = error?.statusCode ?? error?.status;
  const parsedStatus = Number(rawStatus);
  return Number.isFinite(parsedStatus) ? parsedStatus : null;
}

function toSearchText(error: unknown) {
  const record = toErrorRecord(error);
  const values = [
    error instanceof Error ? error.message : null,
    record?.message,
    record?.error,
    record?.code,
    record?.name,
  ];

  return values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function classifyEstimatePdfStorageFailure(
  error: unknown,
  operation: EstimatePdfStorageOperation
) {
  const record = toErrorRecord(error);
  const statusCode = toStatusCode(record);
  const searchText = toSearchText(error);

  if (
    searchText.includes("bucket not found") ||
    searchText.includes("bucket does not exist")
  ) {
    return {
      reason: "bucket_missing" as const,
      message: "Le stockage PDF n'est pas configure pour cet environnement.",
    };
  }

  if (
    searchText.includes("signature verification failed") ||
    searchText.includes("invalid api key") ||
    searchText.includes("invalid jwt") ||
    ((statusCode === 401 || statusCode === 403) &&
      searchText.includes("unauthorized"))
  ) {
    return {
      reason: "server_auth_invalid" as const,
      message:
        "La configuration serveur Supabase du stockage PDF est invalide.",
    };
  }

  return {
    reason: "storage_unavailable" as const,
    message:
      operation === "upload"
        ? "Impossible d'enregistrer le PDF. Réessayez ou contactez un administrateur."
        : "Impossible de préparer le téléchargement du PDF. Réessayez ou contactez un administrateur.",
  };
}

/** Keep provider messages, object paths and nested requests out of server logs. */
export function logEstimatePdfStorageFailure(
  error: unknown,
  operation: EstimatePdfStorageOperation,
  bytes?: number,
) {
  const record = toErrorRecord(error);
  const status = Number(record?.status ?? record?.statusCode);
  const knownCodes = new Set([
    "AccessDenied", "DatabaseError", "DatabaseTimeout", "EntityTooLarge",
    "InternalError", "InvalidInput", "InvalidJWT", "InvalidMimeType",
    "InvalidSignature", "KeyAlreadyExists", "NoSuchBucket", "NoSuchKey",
    "PayloadTooLarge", "RequestTimeout", "ResourceAlreadyExists", "SlowDown",
    "TooManyRequests",
  ]);
  const knownTypes = new Set(["StorageError", "StorageApiError", "StorageUnknownError", "TypeError", "Error"]);
  const network = toErrorRecord(record?.originalError);
  const cause = toErrorRecord(network?.cause);
  const networkCodes = new Set([
    "EADDRNOTAVAIL", "EADDRINUSE", "EMFILE", "ENFILE", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
    "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH", "ABORT_ERR", "ERR_INVALID_STATE",
  ]);
  const code = network?.code ?? cause?.code;
  const message = typeof network?.message === "string" ? network.message.toLowerCase() : "";
  const networkKind = message.includes("fetch failed") ? "fetch_failed"
    : message.includes("duplex") ? "duplex_required"
    : /disturbed|locked/.test(message) ? "body_locked"
    : message.includes("abort") ? "aborted"
    : message.includes("invalid url") ? "invalid_url" : "other";
  console.error("estimate_pdf_storage_failure", {
    operation,
    reason: classifyEstimatePdfStorageFailure(error, operation).reason,
    httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    providerCode: typeof record?.code === "string" && knownCodes.has(record.code) ? record.code : "other",
    errorType: typeof record?.name === "string" && knownTypes.has(record.name) ? record.name : "other",
    ...(network ? {
      networkType: typeof network.name === "string" && ["TypeError", "Error", "AbortError", "TimeoutError"].includes(network.name) ? network.name : "other",
      networkCode: typeof code === "string" && networkCodes.has(code) ? code : "other",
      networkKind,
    } : {}),
    ...(bytes === undefined ? {} : { bytes }),
  });
}
