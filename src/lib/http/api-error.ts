/**
 * Typed API errors, with no dependency on `next/server`: client modules import them.
 * The HTTP mapping that needs `NextResponse` is in `@/lib/http/api-response`.
 */
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

export type ApiErrorBody = {
  code: ApiErrorCode | string;
  message: string;
  details?: unknown;
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

export type ApiErrorFactoryInit = {
  status: 400 | 401 | 403 | 404 | 409 | 500;
  code: string;
  message: string;
  details?: unknown;
};

/**
 * The six error factories above, built on a domain's own error class
 * (which stays unrelated to ApiError).
 */
export function apiErrorFactories<E>(create: (init: ApiErrorFactoryInit) => E) {
  return {
    badRequest(message: string, details?: unknown, code = "BAD_REQUEST") {
      return create({
        status: 400,
        code,
        message,
        details,
      });
    },
    unauthorized(message = "Unauthorized") {
      return create({
        status: 401,
        code: "UNAUTHORIZED",
        message,
      });
    },
    forbidden(message = "Accès refusé.", details?: unknown, code = "FORBIDDEN") {
      return create({
        status: 403,
        code,
        message,
        details,
      });
    },
    notFound(message: string, details?: unknown, code = "NOT_FOUND") {
      return create({
        status: 404,
        code,
        message,
        details,
      });
    },
    conflict(message: string, details?: unknown, code = "CONFLICT") {
      return create({
        status: 409,
        code,
        message,
        details,
      });
    },
    internalError(
      message = "Une erreur interne est survenue.",
      details?: unknown,
      code: ApiErrorCode | string = "INTERNAL_ERROR"
    ) {
      return create({
        status: 500,
        code,
        message,
        details,
      });
    },
  };
}

/**
 * A refusal a domain module throws by name without building an HTTP error:
 * `toErrorResponse` answers 409 with its code and message.
 */
export class NamedRefusal extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
