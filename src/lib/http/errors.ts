import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type HttpApiErrorLike = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

export type ApiFailureResponseBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ErrorDetailsMode = "policy" | "never";

export type BuildErrorResponseBodyOptions = {
  /**
   * `policy` (default): K-01 shared details policy.
   * `never`: omit details from the JSON body (imports/mappings/catalogue).
   */
  detailsMode?: ErrorDetailsMode;
  detailsLogScope?: string;
};

export type ToErrorResponseOptions<TError extends HttpApiErrorLike = HttpApiErrorLike> = {
  isApiError: (error: unknown) => error is TError;
  mapZodError?: (error: ZodError) => TError;
  createInternalError: () => TError;
  unexpectedLogMessage: string;
  detailsMode?: ErrorDetailsMode;
  detailsLogScope?: string;
};

const SQLSTATE_OR_POSTGREST_CODE = /^(?:[0-9][0-9A-Z]{4}|PGRST\d+)$/;

function isJsonPrimitive(
  value: unknown
): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isZodIssuesDetails(value: unknown): boolean {
  if (!isPlainObject(value) || !Array.isArray(value.issues)) {
    return false;
  }

  return value.issues.every((issue) => {
    if (!isPlainObject(issue) || typeof issue.message !== "string") {
      return false;
    }

    return "path" in issue;
  });
}

export function isPostgrestErrorLike(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  const code = value.code;
  const hasCode = typeof code === "string" && code.length > 0;
  const hasMessage = typeof value.message === "string";
  const hasHint = "hint" in value;
  const hasDetails = "details" in value;

  if (hasHint && (hasCode || hasMessage || hasDetails)) {
    return true;
  }

  if (hasCode && hasMessage && (hasDetails || hasHint)) {
    return true;
  }

  return (
    hasCode &&
    SQLSTATE_OR_POSTGREST_CODE.test(code) &&
    (hasMessage || hasDetails || hasHint)
  );
}

function isClientSafeDetails(value: unknown): boolean {
  if (isJsonPrimitive(value)) {
    return true;
  }

  if (isZodIssuesDetails(value)) {
    return true;
  }

  if (isPostgrestErrorLike(value)) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.every(isClientSafeDetails);
  }

  if (!isPlainObject(value) || typeof value.stack === "string") {
    return false;
  }

  return Object.values(value).every(
    (entry) => entry === undefined || isClientSafeDetails(entry)
  );
}

/**
 * K-01: internal/Supabase details are not returned to the client; Zod issues may.
 */
export function shouldExposeErrorDetails(
  details: unknown,
  context: { code?: string; status?: number } = {}
): boolean {
  if (details === undefined || details === null) {
    return false;
  }

  if (context.code === "INTERNAL_ERROR" || context.status === 500) {
    return false;
  }

  return isClientSafeDetails(details);
}

function logRedactedDetails(apiError: HttpApiErrorLike, detailsLogScope?: string) {
  if (!apiError.details) {
    return;
  }

  // K-01: Log internal details server-side only, never expose to client
  if (detailsLogScope) {
    console.error(
      `[${detailsLogScope}] API error details (${apiError.code}):`,
      apiError.details
    );
    return;
  }

  console.error("API error details", apiError.code, apiError.details);
}

export function buildErrorResponseBody(
  apiError: HttpApiErrorLike,
  options: BuildErrorResponseBodyOptions = {}
): ApiFailureResponseBody {
  const detailsMode = options.detailsMode ?? "policy";
  const exposeDetails =
    detailsMode === "never"
      ? false
      : shouldExposeErrorDetails(apiError.details, {
          code: apiError.code,
          status: apiError.status,
        });

  if (!exposeDetails) {
    logRedactedDetails(apiError, options.detailsLogScope);
  }

  const error: ApiFailureResponseBody["error"] = {
    code: apiError.code,
    message: apiError.message,
  };

  if (exposeDetails && apiError.details !== undefined) {
    error.details = apiError.details;
  }

  return {
    ok: false,
    error,
  };
}

function resolveApiError<TError extends HttpApiErrorLike>(
  error: unknown,
  options: ToErrorResponseOptions<TError>
): TError {
  if (options.isApiError(error)) {
    return error;
  }

  if (options.mapZodError && error instanceof ZodError) {
    return options.mapZodError(error);
  }

  console.error(options.unexpectedLogMessage, error);
  return options.createInternalError();
}

export function toErrorResponse<TError extends HttpApiErrorLike>(
  error: unknown,
  options: ToErrorResponseOptions<TError>
): NextResponse<ApiFailureResponseBody> {
  const apiError = resolveApiError(error, options);
  return NextResponse.json(
    buildErrorResponseBody(apiError, {
      detailsMode: options.detailsMode,
      detailsLogScope: options.detailsLogScope,
    }),
    { status: apiError.status }
  );
}
