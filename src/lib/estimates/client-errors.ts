export {
  extractErrorCode,
  extractErrorDetails,
  resolveEnvelopeErrorMessage,
  toErrorMessage,
  type ApiEnvelope,
} from "@/lib/http/error-body";

export class EstimateApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly code: string | null;

  constructor(
    message: string,
    status: number,
    details: unknown,
    code: string | null
  ) {
    super(message);
    this.name = "EstimateApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export function isEstimateApiError(error: unknown): error is EstimateApiError {
  return error instanceof EstimateApiError;
}
