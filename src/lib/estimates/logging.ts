import { ApiError } from "@/lib/estimates/errors";

function resolveErrorDigest(error: Error) {
  return "digest" in error && typeof error.digest === "string"
    ? error.digest
    : null;
}

export function toSafeEstimateErrorLogDetails(error: unknown) {
  if (error instanceof ApiError) {
    const digest = resolveErrorDigest(error);

    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStatus: error.status,
      errorCode: error.code,
      ...(error.details !== undefined ? { errorDetails: error.details } : {}),
      ...(digest ? { errorDigest: digest } : {}),
    };
  }

  if (error instanceof Error) {
    const digest = resolveErrorDigest(error);

    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(digest ? { errorDigest: digest } : {}),
    };
  }

  return {
    errorMessage: typeof error === "string" ? error : "Unknown error",
  };
}
