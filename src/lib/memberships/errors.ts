import type { PostgrestError } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { toErrorResponse as toSharedErrorResponse } from "@/lib/http/errors";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

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

export class MembershipsApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 500;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor({
    status,
    code,
    message,
    details,
  }: {
    status: 400 | 401 | 403 | 404 | 409 | 500;
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  }) {
    super(message);
    this.name = "MembershipsApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok<T>(data: T, status: 200 | 201 = 200) {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      ok: true,
      data,
    },
    { status }
  );
}

export function badRequest(message: string, details?: unknown, code = "BAD_REQUEST") {
  return new MembershipsApiError({
    status: 400,
    code,
    message,
    details,
  });
}

export function unauthorized(message = "Unauthorized") {
  return new MembershipsApiError({
    status: 401,
    code: "UNAUTHORIZED",
    message,
  });
}

export function forbidden(message: string, details?: unknown, code = "FORBIDDEN") {
  return new MembershipsApiError({
    status: 403,
    code,
    message,
    details,
  });
}

export function notFound(message: string, details?: unknown, code = "NOT_FOUND") {
  return new MembershipsApiError({
    status: 404,
    code,
    message,
    details,
  });
}

export function conflict(message: string, details?: unknown, code = "CONFLICT") {
  return new MembershipsApiError({
    status: 409,
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
  return new MembershipsApiError({
    status: 500,
    code,
    message,
    details,
  });
}

export function mapSupabaseError(
  error: PostgrestError,
  fallbackMessage: string
): MembershipsApiError {
  const normalizedMessage = (error.message ?? "").toLowerCase();

  if (
    error.code === "42501" ||
    normalizedMessage.includes("row-level security")
  ) {
    return forbidden("Acces refuse.", error, "FORBIDDEN");
  }

  if (error.code === "PGRST116") {
    return notFound("Ressource introuvable.", error, "NOT_FOUND");
  }

  if (error.code === "23505") {
    return conflict("Conflit de données.", error, "CONFLICT");
  }

  if (
    error.code === "23503" ||
    error.code === "23514" ||
    error.code === "22P02"
  ) {
    return badRequest(fallbackMessage, error, "BAD_REQUEST");
  }

  return badRequest(fallbackMessage, error, "BAD_REQUEST");
}

function fromZodError(error: ZodError): MembershipsApiError {
  return new MembershipsApiError({
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
  return toSharedErrorResponse(error, {
    isApiError: (value): value is MembershipsApiError =>
      value instanceof MembershipsApiError,
    mapZodError: fromZodError,
    createInternalError: () => internalError(),
    unexpectedLogMessage: "Unexpected memberships API error",
  });
}
