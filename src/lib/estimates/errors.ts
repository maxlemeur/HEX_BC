import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "READ_ONLY"
  | "LOCK_REQUIRED"
  | "ESTIMATE_TEMPLATE_NOT_FOUND"
  | "ESTIMATE_TEMPLATE_SOURCE_VERSION_NOT_FOUND"
  | "ESTIMATE_TEMPLATE_NAME_CONFLICT"
  | "ESTIMATE_TEMPLATE_INSTANTIATE_FAILED"
  | "ESTIMATE_ASSEMBLY_NOT_FOUND"
  | "ESTIMATE_ASSEMBLY_NAME_CONFLICT"
  | "ESTIMATE_ASSEMBLY_INSERT_FAILED"
  | "PDF_NOT_READY"
  | "PDF_GENERATION_FAILED";

type ApiErrorBody = {
  code: ApiErrorCode | string;
  message: string;
  details?: unknown;
};

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
};

export type ApiFailureResponse = {
  ok: false;
  error: ApiErrorBody;
};

export class ApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor({
    status,
    code,
    message,
    details,
  }: {
    status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503;
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, status: 200 | 201 | 202 = 200) {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      ok: true,
      data,
    },
    { status }
  );
}

export function badRequest(message: string, details?: unknown, code = "BAD_REQUEST") {
  return new ApiError({
    status: 400,
    code,
    message,
    details,
  });
}

export function unauthorized(message = "Unauthorized") {
  return new ApiError({
    status: 401,
    code: "UNAUTHORIZED",
    message,
  });
}

export function forbidden(message: string, details?: unknown, code = "FORBIDDEN") {
  return new ApiError({
    status: 403,
    code,
    message,
    details,
  });
}

export function notFound(message: string, details?: unknown, code = "NOT_FOUND") {
  return new ApiError({
    status: 404,
    code,
    message,
    details,
  });
}

export function conflict(message: string, details?: unknown, code = "CONFLICT") {
  return new ApiError({
    status: 409,
    code,
    message,
    details,
  });
}

export function payloadTooLarge(
  message: string,
  details?: unknown,
  code = "PAYLOAD_TOO_LARGE"
) {
  return new ApiError({
    status: 413,
    code,
    message,
    details,
  });
}

export function unprocessableEntity(
  message: string,
  details?: unknown,
  code = "UNPROCESSABLE_ENTITY"
) {
  return new ApiError({
    status: 422,
    code,
    message,
    details,
  });
}

export function internalError(
  message = "Une erreur interne est survenue.",
  details?: unknown,
  code: ApiErrorCode | string = "INTERNAL_ERROR"
) {
  return new ApiError({
    status: 500,
    code,
    message,
    details,
  });
}

/**
 * Forme minimale consommee par mapSupabaseError : le `PostgrestError` de
 * supabase-js la satisfait, tout comme les erreurs RPC typees localement
 * (qui n'exposent ni `name` ni `toJSON`).
 */
export type SupabaseErrorLike = {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

/**
 * Ne laisse sortir que le SQLSTATE.
 *
 * `details` est serialise tel quel dans la reponse HTTP (cf. `failure`), et
 * l'objet d'erreur Supabase transporte `message`, `hint` et `details` bruts de
 * PostgreSQL : noms de contraintes, de colonnes et parfois valeurs de ligne.
 * Le code reste expose, c'est lui que le client exploite pour distinguer un
 * conflit d'un acces refuse ; le detail complet part dans les logs serveur.
 */
function toPublicSupabaseErrorDetails(error: SupabaseErrorLike) {
  console.error("Supabase error", error);
  return error.code ? { code: error.code } : undefined;
}

export function mapSupabaseError(
  error: SupabaseErrorLike,
  fallbackMessage: string
): ApiError {
  const normalizedMessage = (error.message ?? "").toLowerCase();
  const publicDetails = toPublicSupabaseErrorDetails(error);

  if (
    error.code === "42501" ||
    normalizedMessage.includes("row-level security")
  ) {
    return forbidden("Acces refuse.", publicDetails, "FORBIDDEN");
  }

  if (error.code === "PGRST116") {
    return notFound("Ressource introuvable.", publicDetails, "NOT_FOUND");
  }

  if (error.code === "23505") {
    return conflict("Conflit de donnees.", publicDetails, "CONFLICT");
  }

  if (
    normalizedMessage.includes("read-only") ||
    normalizedMessage.includes("read only")
  ) {
    return forbidden("Cette version est en lecture seule.", publicDetails, "READ_ONLY");
  }

  if (
    error.code === "23503" ||
    error.code === "23514" ||
    error.code === "22P02"
  ) {
    return badRequest(fallbackMessage, publicDetails, "BAD_REQUEST");
  }

  return badRequest(fallbackMessage, publicDetails, "BAD_REQUEST");
}

function fromZodError(error: ZodError): ApiError {
  return new ApiError({
    status: 400,
    code: "VALIDATION_ERROR",
    message: "Payload invalide.",
    details: {
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    },
  });
}

export function toErrorResponse(error: unknown) {
  let apiError: ApiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    apiError = fromZodError(error);
  } else {
    console.error("Unexpected estimate API error", error);
    apiError = internalError();
  }

  const body: ApiFailureResponse = {
    ok: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
    },
  };

  return NextResponse.json(body, { status: apiError.status });
}
