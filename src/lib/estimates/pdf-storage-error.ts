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
        ? "Impossible d'enregistrer le PDF. Reessayez ou contactez un administrateur."
        : "Impossible de preparer le telechargement du PDF. Reessayez ou contactez un administrateur.",
  };
}
