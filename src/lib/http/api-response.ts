import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { buildErrorResponseBody, toErrorResponse as toSharedErrorResponse } from "@/lib/http/errors";

import {
  ApiError,
  NamedRefusal,
  badRequest,
  conflict,
  forbidden,
  internalError,
  notFound,
  type ApiErrorBody,
} from "@/lib/http/api-error";

export {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  internalError,
  notFound,
  payloadTooLarge,
  unauthorized,
  unprocessableEntity,
  type ApiErrorCode,
} from "@/lib/http/api-error";

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
};

export type ApiFailureResponse = {
  ok: false;
  error: ApiErrorBody;
};

export function ok<T>(data: T, status: 200 | 201 | 202 = 200) {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      ok: true,
      data,
    },
    { status }
  );
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

/**
 * Refus transitoire du verrou de calcul du tenant : les triggers de
 * labor_roles, margin_tiers, feature_flags, tenant_memberships et tenants
 * tentent ce verrou sans attendre pendant qu'un calcul le détient (création de
 * ligne, lot, réglages). Rien n'est écrit ; l'appelant peut réessayer.
 */
export function isCalculationContextConflict(error: SupabaseErrorLike) {
  return error.code === "40001" && error.message === "ESTIMATE_CREATE_CONTEXT_CHANGED";
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
    return forbidden("Accès refusé.", publicDetails, "FORBIDDEN");
  }

  if (isCalculationContextConflict(error)) {
    return conflict(
      "Un calcul de devis est en cours dans l'entreprise. Réessayez dans un instant.",
      publicDetails,
      "CONTEXT_CHANGED"
    );
  }

  if (error.code === "PGRST116") {
    return notFound("Ressource introuvable.", publicDetails, "NOT_FOUND");
  }

  if (error.code === "23505") {
    return conflict("Conflit de données.", publicDetails, "CONFLICT");
  }

  if (
    normalizedMessage.includes("read-only") ||
    normalizedMessage.includes("read only")
  ) {
    return forbidden("Cette version est en lecture seule.", publicDetails, "READ_ONLY");
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
  const mappedError = error instanceof NamedRefusal
    ? conflict(error.message, undefined, error.code)
    : error;
  return toSharedErrorResponse(mappedError, {
    isApiError: (value): value is ApiError => value instanceof ApiError,
    mapZodError: fromZodError,
    createInternalError: () => internalError(),
    unexpectedLogMessage: "Unexpected API error",
  });
}

/** A known HTTP refusal with a message written for the caller. */
export function apiFailure(status: number, code: string, message: string) {
  return NextResponse.json(buildErrorResponseBody({ status, code, message }), { status });
}
