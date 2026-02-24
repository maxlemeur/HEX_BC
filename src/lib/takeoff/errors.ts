import { ZodError } from "zod";

import { ApiError } from "@/lib/estimates/errors";

export type TakeoffErrorCode =
  | "AI_RATE_LIMIT"
  | "AI_TIMEOUT"
  | "AI_SCHEMA"
  | "AI_SAFETY"
  | "AI_PROVIDER";

type TakeoffErrorStatus = ApiError["status"];

function toMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
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
  if (code === "AI_SCHEMA") return 422;
  return 500;
}

function getDefaultMessage(code: TakeoffErrorCode) {
  if (code === "AI_RATE_LIMIT") {
    return "Le fournisseur IA refuse temporairement la requete (rate limit).";
  }

  if (code === "AI_TIMEOUT") {
    return "Le delai d'appel au fournisseur IA est depasse.";
  }

  if (code === "AI_SCHEMA") {
    return "La reponse IA ne respecte pas le schema attendu.";
  }

  if (code === "AI_SAFETY") {
    return "La reponse IA a ete bloquee par les filtres de securite.";
  }

  return "Le fournisseur IA a retourne une erreur.";
}

export class TakeoffError extends ApiError {
  readonly retryable: boolean;

  constructor(input: {
    code: TakeoffErrorCode;
    message?: string;
    details?: unknown;
    status?: TakeoffErrorStatus;
    retryable: boolean;
  }) {
    super({
      status: input.status ?? getStatusFromCode(input.code),
      code: input.code,
      message: input.message ?? getDefaultMessage(input.code),
      details: input.details,
    });

    this.name = "TakeoffError";
    this.retryable = input.retryable;
  }
}

export function mapGeminiErrorToTakeoffError(error: unknown): TakeoffError {
  if (error instanceof TakeoffError) {
    return error;
  }

  if (isRateLimitError(error)) {
    return new TakeoffError({
      code: "AI_RATE_LIMIT",
      retryable: true,
      details: error,
      message: toMessage(error) ?? undefined,
    });
  }

  if (isTimeoutError(error)) {
    return new TakeoffError({
      code: "AI_TIMEOUT",
      retryable: true,
      details: error,
      message: toMessage(error) ?? undefined,
    });
  }

  if (isSchemaError(error)) {
    return new TakeoffError({
      code: "AI_SCHEMA",
      retryable: false,
      details: error,
      message: toMessage(error) ?? undefined,
    });
  }

  if (isSafetyError(error)) {
    return new TakeoffError({
      code: "AI_SAFETY",
      retryable: false,
      details: error,
      message: toMessage(error) ?? undefined,
    });
  }

  const status = extractStatus(error);
  const retryable = status === 500 || status === 503;

  return new TakeoffError({
    code: "AI_PROVIDER",
    retryable,
    details: error,
    message: toMessage(error) ?? undefined,
  });
}
