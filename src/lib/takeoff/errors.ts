import { ZodError } from "zod";

import { ApiError } from "@/lib/estimates/errors";
import type { TakeoffLevel } from "@/lib/takeoff/types";

export enum TakeoffErrorCode {
  BAD_REQUEST = "BAD_REQUEST",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  READ_ONLY = "READ_ONLY",
  TAKEOFF_MODULE_DISABLED = "TAKEOFF_MODULE_DISABLED",
  TAKEOFF_FILE_REQUIRED = "TAKEOFF_FILE_REQUIRED",
  TAKEOFF_FILE_TOO_LARGE = "TAKEOFF_FILE_TOO_LARGE",
  TAKEOFF_FILE_TYPE_INVALID = "TAKEOFF_FILE_TYPE_INVALID",
  TAKEOFF_LEVEL_UNSUPPORTED = "TAKEOFF_LEVEL_UNSUPPORTED",
  TAKEOFF_ESTIMATE_VERSION_ID_INVALID = "TAKEOFF_ESTIMATE_VERSION_ID_INVALID",
  TAKEOFF_JOB_NOT_FOUND = "TAKEOFF_JOB_NOT_FOUND",
  TAKEOFF_TENANT_UNAUTHORIZED = "TAKEOFF_TENANT_UNAUTHORIZED",
  IDEMPOTENCY_KEY_INVALID = "IDEMPOTENCY_KEY_INVALID",
  IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED",
  AI_RATE_LIMIT = "AI_RATE_LIMIT",
  AI_TIMEOUT = "AI_TIMEOUT",
  AI_SCHEMA = "AI_SCHEMA",
  AI_SAFETY = "AI_SAFETY",
  AI_PROVIDER = "AI_PROVIDER",
  TAKEOFF_LEVEL_C_TIMEOUT = "TAKEOFF_LEVEL_C_TIMEOUT",
  TAKEOFF_LEVEL_C_INVALID_SCHEMA = "TAKEOFF_LEVEL_C_INVALID_SCHEMA",
  TAKEOFF_LEVEL_C_BUDGET_EXCEEDED = "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED",
  TAKEOFF_JOB_NOT_RETRIABLE = "TAKEOFF_JOB_NOT_RETRIABLE",
  TAKEOFF_JOB_NOT_CANCELABLE = "TAKEOFF_JOB_NOT_CANCELABLE",
  TAKEOFF_APPLY_GUARD_FAILED = "TAKEOFF_APPLY_GUARD_FAILED",
}

type TakeoffErrorStatus = ApiError["status"];

type JsonRecord = Record<string, unknown>;

type ToTakeoffErrorOptions = {
  fallbackCode?: TakeoffErrorCode;
  fallbackMessage?: string;
  fallbackStatus?: TakeoffErrorStatus;
  retryable?: boolean;
  jobId?: string;
  level?: TakeoffLevel;
  logUnexpected?: boolean;
};

export type TakeoffErrorResponse = {
  ok: false;
  error: {
    code: TakeoffErrorCode | string;
    message: string;
    details?: unknown;
    retryable: boolean;
    jobId?: string;
    level?: TakeoffLevel;
  };
};

const SECRET_KEY_NAME_REGEX =
  /(api[-_]?key|authorization|token|secret|password|cookie|x-goog-api-key)/i;
const GOOGLE_API_KEY_VALUE_REGEX = /AIza[0-9A-Za-z\-_]{20,}/g;
const BEARER_TOKEN_VALUE_REGEX = /(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi;
const TAKEOFF_ERROR_CODES = new Set<TakeoffErrorCode>(
  Object.values(TakeoffErrorCode)
);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactString(value: string) {
  return value
    .replace(GOOGLE_API_KEY_VALUE_REGEX, "[REDACTED_API_KEY]")
    .replace(BEARER_TOKEN_VALUE_REGEX, "$1[REDACTED]");
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (depth >= 4) {
    return "[TRUNCATED]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeUnknown(entry, depth + 1));
  }

  if (value instanceof Error) {
    const err = value as Error & {
      code?: unknown;
      status?: unknown;
      details?: unknown;
      cause?: unknown;
    };

    return compactRecord({
      name: err.name || "Error",
      message: redactString(err.message || "Unknown error"),
      code: typeof err.code === "string" ? err.code : undefined,
      status: typeof err.status === "number" ? err.status : undefined,
      details: sanitizeUnknown(err.details, depth + 1),
      cause: sanitizeUnknown(err.cause, depth + 1),
    });
  }

  if (!isRecord(value)) {
    return String(value);
  }

  const output: JsonRecord = {};
  let written = 0;

  for (const [key, entry] of Object.entries(value)) {
    if (written >= 40) {
      output._truncated = true;
      break;
    }

    if (SECRET_KEY_NAME_REGEX.test(key)) {
      output[key] = "[REDACTED]";
      written += 1;
      continue;
    }

    output[key] = sanitizeUnknown(entry, depth + 1);
    written += 1;
  }

  return output;
}

function compactRecord(record: JsonRecord) {
  const output: JsonRecord = {};

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    output[key] = value;
  }

  return output;
}

function toMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return redactString(error.message);
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return redactString(error);
  }

  return null;
}

function toRecord(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  return value;
}

function extractStatus(error: unknown): number | null {
  const record = toRecord(error);
  if (!record) return null;

  if (typeof record.status === "number") {
    return record.status;
  }

  const response = toRecord(record.response);
  if (response && typeof response.status === "number") {
    return response.status;
  }

  return null;
}

function extractCode(error: unknown): string | null {
  const record = toRecord(error);
  if (!record) return null;

  if (typeof record.code === "string" && record.code.trim().length > 0) {
    return record.code.trim().toUpperCase();
  }

  return null;
}

function extractProviderDetails(error: unknown): unknown {
  const record = toRecord(error);
  const response = record ? toRecord(record.response) : null;
  const nestedDetails =
    record && Object.prototype.hasOwnProperty.call(record, "details")
      ? record.details
      : response && Object.prototype.hasOwnProperty.call(response, "data")
      ? response.data
      : undefined;

  return compactRecord({
    provider_status: extractStatus(error) ?? undefined,
    provider_code: extractCode(error) ?? undefined,
    provider_message: toMessage(error) ?? undefined,
    provider_details: sanitizeUnknown(nestedDetails),
  });
}

function isTimeoutError(error: unknown) {
  const message = (toMessage(error) ?? "").toLowerCase();
  const code = extractCode(error);
  const name =
    error instanceof Error && error.name ? error.name.toLowerCase() : "";

  return (
    name === "aborterror" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("deadline exceeded")
  );
}

function isRateLimitError(error: unknown) {
  const status = extractStatus(error);
  if (status === 429) return true;

  const message = (toMessage(error) ?? "").toLowerCase();
  return message.includes("rate limit") || message.includes("too many requests");
}

function isSafetyError(error: unknown) {
  const message = (toMessage(error) ?? "").toLowerCase();
  const code = extractCode(error);

  return (
    code === "SAFETY" ||
    message.includes("safety") ||
    message.includes("blocked") ||
    message.includes("content policy")
  );
}

function isSchemaError(error: unknown) {
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return true;
  }

  const message = (toMessage(error) ?? "").toLowerCase();
  const code = extractCode(error);

  return (
    code === "AI_SCHEMA" ||
    message.includes("invalid json") ||
    message.includes("schema") ||
    message.includes("zod")
  );
}

function getStatusFromCode(code: TakeoffErrorCode): TakeoffErrorStatus {
  if (code === TakeoffErrorCode.UNAUTHORIZED) return 401;
  if (
    code === TakeoffErrorCode.FORBIDDEN ||
    code === TakeoffErrorCode.READ_ONLY ||
    code === TakeoffErrorCode.TAKEOFF_MODULE_DISABLED ||
    code === TakeoffErrorCode.TAKEOFF_TENANT_UNAUTHORIZED
  ) {
    return 403;
  }

  if (
    code === TakeoffErrorCode.NOT_FOUND ||
    code === TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND
  ) {
    return 404;
  }

  if (
    code === TakeoffErrorCode.CONFLICT ||
    code === TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED ||
    code === TakeoffErrorCode.TAKEOFF_JOB_NOT_RETRIABLE ||
    code === TakeoffErrorCode.TAKEOFF_JOB_NOT_CANCELABLE
  ) {
    return 409;
  }

  if (code === TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE) {
    return 413;
  }

  if (
    code === TakeoffErrorCode.VALIDATION_ERROR ||
    code === TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID ||
    code === TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED ||
    code === TakeoffErrorCode.TAKEOFF_ESTIMATE_VERSION_ID_INVALID ||
    code === TakeoffErrorCode.AI_SCHEMA ||
    code === TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA ||
    code === TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED ||
    code === TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED
  ) {
    return 422;
  }

  if (code === TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT) {
    return 500;
  }

  if (code === TakeoffErrorCode.IDEMPOTENCY_KEY_INVALID) {
    return 422;
  }

  if (
    code === TakeoffErrorCode.BAD_REQUEST ||
    code === TakeoffErrorCode.TAKEOFF_FILE_REQUIRED
  ) {
    return 400;
  }

  return 500;
}

function getDefaultMessage(code: TakeoffErrorCode) {
  if (code === TakeoffErrorCode.AI_RATE_LIMIT) {
    return "Le fournisseur IA refuse temporairement la requete (rate limit).";
  }

  if (code === TakeoffErrorCode.AI_TIMEOUT) {
    return "Le delai d'appel au fournisseur IA est depasse.";
  }

  if (code === TakeoffErrorCode.AI_SCHEMA) {
    return "La reponse IA ne respecte pas le schema attendu.";
  }

  if (code === TakeoffErrorCode.AI_SAFETY) {
    return "La reponse IA a ete bloquee par les filtres de securite.";
  }

  if (code === TakeoffErrorCode.AI_PROVIDER) {
    return "Le fournisseur IA a retourne une erreur.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT) {
    return "Le delai de traitement Level C est depasse.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_LEVEL_C_INVALID_SCHEMA) {
    return "La sortie Level C ne respecte pas le schema attendu.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_LEVEL_C_BUDGET_EXCEEDED) {
    return "Le budget Level C configure est depasse.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND) {
    return "Le job Takeoff est introuvable.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_TENANT_UNAUTHORIZED) {
    return "Acces interdit aux ressources de ce tenant.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_FILE_REQUIRED) {
    return "Le champ file est requis.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_JOB_NOT_RETRIABLE) {
    return "Le job n'est pas dans un etat permettant la relance.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_JOB_NOT_CANCELABLE) {
    return "Le job n'est pas dans un etat permettant l'annulation.";
  }

  if (code === TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED) {
    return "Des items a faible confiance n'ont pas ete verifies. Verifiez-les ou utilisez un override admin.";
  }

  if (code === TakeoffErrorCode.INTERNAL_ERROR) {
    return "Une erreur interne est survenue.";
  }

  return "Une erreur Takeoff est survenue.";
}

function defaultRetryable(code: TakeoffErrorCode) {
  return (
    code === TakeoffErrorCode.AI_RATE_LIMIT ||
    code === TakeoffErrorCode.AI_TIMEOUT ||
    code === TakeoffErrorCode.AI_PROVIDER ||
    code === TakeoffErrorCode.TAKEOFF_LEVEL_C_TIMEOUT
  );
}

function normalizeDetails(input: {
  details?: unknown;
  retryable: boolean;
  jobId?: string;
  level?: TakeoffLevel;
}) {
  const sanitized = sanitizeUnknown(input.details);
  const details: JsonRecord =
    isRecord(sanitized)
      ? { ...sanitized }
      : sanitized === undefined || sanitized === null
      ? {}
      : { cause: sanitized };

  details.retryable = input.retryable;

  if (input.jobId) {
    details.jobId = input.jobId;
    details.job_id = input.jobId;
  }

  if (input.level) {
    details.level = input.level;
  }

  return details;
}

function isTakeoffErrorCode(code: string): code is TakeoffErrorCode {
  return TAKEOFF_ERROR_CODES.has(code as TakeoffErrorCode);
}

function toTakeoffErrorCode(code: TakeoffErrorCode | string): TakeoffErrorCode {
  const normalized = code.trim().toUpperCase();
  if (isTakeoffErrorCode(normalized)) {
    return normalized;
  }

  return TakeoffErrorCode.INTERNAL_ERROR;
}

function normalizeApiErrorCode(error: ApiError): TakeoffErrorCode {
  const rawCode =
    typeof error.code === "string" ? error.code.trim().toUpperCase() : "";

  if (isTakeoffErrorCode(rawCode)) {
    return rawCode;
  }

  if (rawCode === "PAYLOAD_TOO_LARGE") {
    return TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE;
  }

  if (rawCode === "UNPROCESSABLE_ENTITY") {
    return TakeoffErrorCode.VALIDATION_ERROR;
  }

  if (rawCode === "FORBIDDEN") {
    const message = error.message.toLowerCase();

    if (
      message.includes("tenant") ||
      message.includes("acces interdit aux ressources")
    ) {
      return TakeoffErrorCode.TAKEOFF_TENANT_UNAUTHORIZED;
    }

    return TakeoffErrorCode.FORBIDDEN;
  }

  if (rawCode === "UNAUTHORIZED") {
    return TakeoffErrorCode.UNAUTHORIZED;
  }

  if (rawCode === "NOT_FOUND") {
    return TakeoffErrorCode.NOT_FOUND;
  }

  if (rawCode === "CONFLICT") {
    return TakeoffErrorCode.CONFLICT;
  }

  if (rawCode === "VALIDATION_ERROR") {
    return TakeoffErrorCode.VALIDATION_ERROR;
  }

  if (rawCode === "BAD_REQUEST") {
    return TakeoffErrorCode.BAD_REQUEST;
  }

  if (error.status === 401) return TakeoffErrorCode.UNAUTHORIZED;
  if (error.status === 403) return TakeoffErrorCode.FORBIDDEN;
  if (error.status === 404) return TakeoffErrorCode.NOT_FOUND;
  if (error.status === 409) return TakeoffErrorCode.CONFLICT;
  if (error.status === 413) return TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE;
  if (error.status === 422) return TakeoffErrorCode.VALIDATION_ERROR;

  return TakeoffErrorCode.INTERNAL_ERROR;
}

export class TakeoffError extends ApiError {
  readonly retryable: boolean;
  readonly jobId?: string;
  readonly level?: TakeoffLevel;

  constructor(input: {
    code: TakeoffErrorCode | string;
    message?: string;
    details?: unknown;
    status?: TakeoffErrorStatus;
    retryable?: boolean;
    jobId?: string;
    level?: TakeoffLevel;
  }) {
    const code = toTakeoffErrorCode(input.code);
    const retryable = input.retryable ?? defaultRetryable(code);

    super({
      status: input.status ?? getStatusFromCode(code),
      code,
      message: input.message ?? getDefaultMessage(code),
      details: normalizeDetails({
        details: input.details,
        retryable,
        jobId: input.jobId,
        level: input.level,
      }),
    });

    this.name = "TakeoffError";
    this.retryable = retryable;
    this.jobId = input.jobId;
    this.level = input.level;
  }
}

export function toTakeoffError(
  error: unknown,
  options: ToTakeoffErrorOptions = {}
): TakeoffError {
  if (error instanceof TakeoffError) {
    if (
      options.retryable === undefined &&
      options.jobId === undefined &&
      options.level === undefined
    ) {
      return error;
    }

    const code =
      typeof error.code === "string" && isTakeoffErrorCode(error.code)
        ? error.code
        : options.fallbackCode ?? TakeoffErrorCode.INTERNAL_ERROR;

    return new TakeoffError({
      code,
      status: error.status,
      message: error.message,
      details: error.details,
      retryable: options.retryable ?? error.retryable,
      jobId: options.jobId ?? error.jobId,
      level: options.level ?? error.level,
    });
  }

  if (error instanceof ApiError) {
    return new TakeoffError({
      code: normalizeApiErrorCode(error),
      status: error.status,
      message: error.message,
      details: error.details,
      retryable: options.retryable,
      jobId: options.jobId,
      level: options.level,
    });
  }

  if (error instanceof ZodError) {
    return new TakeoffError({
      code: TakeoffErrorCode.VALIDATION_ERROR,
      status: 400,
      message: "Payload invalide.",
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      },
      retryable: options.retryable ?? false,
      jobId: options.jobId,
      level: options.level,
    });
  }

  if (options.logUnexpected ?? true) {
    console.error("Unexpected takeoff error", error);
  }

  return new TakeoffError({
    code: options.fallbackCode ?? TakeoffErrorCode.INTERNAL_ERROR,
    status: options.fallbackStatus,
    message: options.fallbackMessage,
    details: error,
    retryable: options.retryable,
    jobId: options.jobId,
    level: options.level,
  });
}

export function toTakeoffErrorResponse(
  error: unknown,
  options: ToTakeoffErrorOptions = {}
): TakeoffErrorResponse {
  const normalized = toTakeoffError(error, options);

  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      retryable: normalized.retryable,
      jobId: normalized.jobId,
      level: normalized.level,
    },
  };
}

export function mapGeminiErrorToTakeoffError(error: unknown): TakeoffError {
  if (error instanceof TakeoffError) {
    return error;
  }

  const details = extractProviderDetails(error);

  if (isRateLimitError(error)) {
    return new TakeoffError({
      code: TakeoffErrorCode.AI_RATE_LIMIT,
      retryable: true,
      details,
      message: toMessage(error) ?? undefined,
    });
  }

  if (isTimeoutError(error)) {
    return new TakeoffError({
      code: TakeoffErrorCode.AI_TIMEOUT,
      retryable: true,
      details,
      message: toMessage(error) ?? undefined,
    });
  }

  if (isSchemaError(error)) {
    return new TakeoffError({
      code: TakeoffErrorCode.AI_SCHEMA,
      retryable: false,
      details,
      message: toMessage(error) ?? undefined,
    });
  }

  if (isSafetyError(error)) {
    return new TakeoffError({
      code: TakeoffErrorCode.AI_SAFETY,
      retryable: false,
      details,
      message: toMessage(error) ?? undefined,
    });
  }

  const status = extractStatus(error);
  const retryable =
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504;

  return new TakeoffError({
    code: TakeoffErrorCode.AI_PROVIDER,
    retryable,
    details,
    message: toMessage(error) ?? undefined,
  });
}
