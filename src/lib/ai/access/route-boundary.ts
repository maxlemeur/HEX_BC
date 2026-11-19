import "server-only";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { ApiKeyError, isApiKeyError, type ApiKeyErrorCode } from "@/lib/ai/access/api-key-errors";
import type { AiAccessOwner } from "@/lib/ai/access/api-key-store";
import { isLoopbackHostname } from "@/lib/ai/access/loopback";
import { assertLocalChatGptHost } from "@/lib/ai/chatgpt-local-auth";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { ApiError, badRequest, forbidden, toErrorResponse } from "@/lib/estimates/errors";
import { isJsonContentType, parseJsonBody } from "@/lib/http/request";

// Server boundary of « Mon profil › Accès IA › Clé API ». Route handlers, not
// server actions: in development Next prints every server action call with its
// arguments in the terminal, which would print the key. Each route checks, on
// the server: MergeOne local (assertLocalChatGptHost), the session and its
// active tenant (the key belongs to that member in that tenant), and for a
// write the page's own origin, plus a JSON content type where a body is read
// (a removal has none). The key itself is accepted on the loopback address
// only: a host listed in MERGEONE_DEV_HOSTS is reached over plain HTTP, and the
// page does not offer the field there either. The body is read once, never
// logged, and a malformed one is answered with a fixed message (a JSON
// parser's message quotes the text it failed on).

export async function requireApiKeyOwner(request: Request,
  options: { write: false } | { write: true; json: boolean; keyInBody?: boolean }): Promise<AiAccessOwner> {
  const requestHeaders = await headers();
  let origin: string;
  try {
    origin = assertLocalChatGptHost(requestHeaders.get("host"), requestHeaders.get("x-forwarded-proto"));
  } catch {
    throw new ApiKeyError("AI_KEY_LOCAL_ONLY");
  }
  if (options.write && options.keyInBody && !isLoopbackHostname(new URL(origin).hostname)) throw new ApiKeyError("AI_KEY_LOOPBACK_ONLY");
  const context = await getAuthenticatedContext();
  if (options.write) {
    if (request.headers.get("origin") !== origin) {
      throw forbidden("Origine de requête refusée : la clé se gère depuis les pages de MergeOne.", undefined, "AI_KEY_ORIGIN");
    }
    if (options.json && !isJsonContentType(request)) {
      throw badRequest("Corps JSON requis (application/json).", undefined, "AI_KEY_BODY");
    }
  }
  return { userId: context.userId, tenantId: context.tenantId };
}

export function readJsonBody(request: Request): Promise<unknown> {
  return parseJsonBody(request, () => badRequest("Corps JSON invalide.", undefined, "AI_KEY_BODY"));
}

const STATUS: Partial<Record<ApiKeyErrorCode, number>> = {
  AI_KEY_FORMAT: 400, AI_KEY_LOCAL_ONLY: 403, AI_KEY_LOOPBACK_ONLY: 403, AI_KEY_KEYCHAIN_LOCKED: 423, AI_KEY_RATE_LIMITED: 429, AI_KEY_UNEXPECTED: 500,
  AI_KEY_RESPONSE_LOST: 502, AI_KEY_UNREACHABLE: 502, AI_KEY_PROVIDER_FAILED: 502, AI_KEY_OUTPUT_LIMIT: 502,
};

const noStore = { "cache-control": "no-store" };

export function apiKeyOk<T>(data: T, status: 200 | 201 = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: noStore });
}

/** Fixed codes and messages only. An unexpected error is neither returned nor logged with its message. */
export function apiKeyRouteError(error: unknown) {
  if (isApiKeyError(error)) {
    return NextResponse.json({ ok: false, error: { code: error.code, message: error.message,
      ...(error.retryAt ? { retryAt: error.retryAt } : {}) } }, { status: STATUS[error.code] ?? 409, headers: noStore });
  }
  if (error instanceof ApiError) {
    const response = toErrorResponse(error);
    response.headers.set("cache-control", "no-store");
    return response;
  }
  console.error("[ai-access] unexpected failure", error instanceof Error ? error.name : typeof error);
  const unexpected = new ApiKeyError("AI_KEY_UNEXPECTED");
  return NextResponse.json({ ok: false, error: { code: unexpected.code, message: unexpected.message } }, { status: 500, headers: noStore });
}
