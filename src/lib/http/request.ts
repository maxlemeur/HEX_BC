import { z } from "zod";

/**
 * Request parsing shared by the API routes. Each domain keeps its own error
 * class, so the caller passes the `badRequest` factory of its domain: the
 * thrown error stays the one its `toErrorResponse` recognizes.
 */
export type BadRequestFactory = (message: string) => Error;

export async function parseJsonBody(
  request: Request,
  badRequest: BadRequestFactory
): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

/** Whether the request declares a JSON body: media type `application/json`, parameters and case ignored. */
export function isJsonContentType(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

/** Same as `parseJsonBody`, but an empty or blank body reads as `{}`. */
export async function parseJsonBodyOrEmptyObject(
  request: Request,
  badRequest: BadRequestFactory
): Promise<unknown> {
  const rawBody = await request.text();
  if (rawBody.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

/**
 * Reads a positive-integer query parameter (`limit`, `page`, `size`); absent
 * means `null`. The error message names `limit` whatever the parameter.
 */
export function parsePositiveIntParam(
  value: string | null,
  badRequest: BadRequestFactory
): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest("Paramètre limit invalide.");
  }

  return parsed;
}

/** Optimistic-concurrency token: the `If-Match` header wins over the body's value. */
export function resolveConcurrencyToken(request: Request, fallback?: string) {
  const ifMatch = request.headers.get("if-match")?.trim();
  if (ifMatch && ifMatch.length > 0) {
    return ifMatch;
  }

  const normalizedFallback = fallback?.trim();
  if (normalizedFallback && normalizedFallback.length > 0) {
    return normalizedFallback;
  }

  return undefined;
}

/** A UUID route parameter whose invalid value is refused as « <name> invalide. ». */
export const uuidParamSchema = (name: string) => z.string().uuid(`${name} invalide.`);

/** `{ id }` of the order routes: a UUID, zod's own message when it is not one. */
export const idParamsSchema = z.object({ id: z.string().uuid() });
export const productParamsSchema = z.object({ productId: uuidParamSchema("productId") });
export const productAliasParamsSchema = productParamsSchema.extend({ aliasId: uuidParamSchema("aliasId") });
export const supplyTypeParamsSchema = z.object({ supplyTypeId: uuidParamSchema("supplyTypeId") });

/**
 * UUID route parameters, validated together. A value that is not a UUID is a
 * validation error naming its parameter, which `toErrorResponse` answers with 400.
 */
export async function uuidRouteParams<Name extends string>(
  params: Promise<Record<Name, string>>,
  ...names: Name[]
): Promise<Record<Name, string>> {
  const schema = z.object(
    Object.fromEntries(names.map((name) => [name, z.string().uuid(`${name} invalide.`)]))
  );
  return schema.parse(await params) as Record<Name, string>;
}

export async function uuidRouteParam<Name extends string>(
  params: Promise<Record<Name, string>>,
  name: Name
): Promise<string> {
  return (await uuidRouteParams(params, name))[name];
}

/** The query string as a plain object, the input of the routes' zod query schemas. */
export function searchParamsObject(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}

/** `superRefine` for PATCH payloads: an update must change at least one field. */
export function rejectEmptyUpdatePayload<T extends object>(payload: T, ctx: z.RefinementCtx<T>) {
  if (Object.keys(payload).length > 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "Aucun champ de mise à jour fourni.",
    path: [],
  });
}
