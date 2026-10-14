import "server-only";

import { z } from "zod";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { InspectedSourceReferencePdf } from "@/lib/estimates/source-reference-pdf";
import { readSourceReferenceReview } from "@/lib/estimates/source-reference-review";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_CONTROL_BYTES = 64 * 1024;
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const locator = z.strictObject({ bucket: z.string(), path: z.string().min(1).max(2048) });
const scope = {
  actorId: uuid, tenantId: uuid, projectId: uuid, versionId: uuid, copyId: uuid,
  destinationLocator: locator,
};
const reservationSchema = z.strictObject({
  copy_id: uuid, version_id: uuid, review_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  state: z.enum(["pending", "verified"]), replayed: z.boolean(),
  source_locator: locator, destination_locator: locator,
});
const preparationSchema = z.strictObject({
  ...scope, purpose: z.literal("prepare"), uploadId: uuid, documentId: uuid,
  reservation: reservationSchema,
});
const readerSchema = z.strictObject({ ...scope, purpose: z.enum(["read", "confirm"]) });
const authorizationSchema = z.discriminatedUnion("purpose", [preparationSchema, readerSchema]);

export type SourceReferencePreparationAuthorization = z.input<typeof preparationSchema>;
export type SourceReferenceReadAuthorization = z.input<typeof readerSchema>;
export type SourceReferenceStorageAuthorization = SourceReferencePreparationAuthorization | SourceReferenceReadAuthorization;

const MESSAGES = {
  STORAGE_INVALID_SCOPE: "Périmètre du document invalide.",
  STORAGE_ACCESS_DENIED: "Accès au document refusé.",
  STORAGE_SOURCE_UNAVAILABLE: "Le document conservé est indisponible.",
  STORAGE_TOO_LARGE: "Le fichier dépasse la limite de 50 Mio.",
  STORAGE_INVALID_RESPONSE: "Réponse du stockage invalide.",
  STORAGE_ABORTED: "Le transfert du document a été interrompu.",
  STORAGE_TIMEOUT: "Le transfert du document a dépassé le délai autorisé.",
  STORAGE_UNAVAILABLE: "Le stockage est temporairement indisponible.",
} as const;

export class SourceReferenceStorageError extends Error {
  constructor(readonly code: keyof typeof MESSAGES) {
    super(MESSAGES[code]);
    this.name = "SourceReferenceStorageError";
  }
}

export type SourceReferenceStorageReader = {
  readCopy(): Promise<ArrayBuffer>;
};
export type SourceReferenceStoragePreparer = {
  readCopy(): Promise<ArrayBuffer | null>;
  readSource(): Promise<ArrayBuffer>;
  uploadCopy(pdf: InspectedSourceReferencePdf): Promise<"created" | "conflict">;
};
type FactoryInput<T extends SourceReferenceStorageAuthorization> = {
  context: AuthenticatedTenantContext;
  authorization: T;
  signal?: AbortSignal;
};

function fail(code: keyof typeof MESSAGES): never {
  throw new SourceReferenceStorageError(code);
}

function configuredBase() {
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!raw || raw.includes("\\")) return fail("STORAGE_UNAVAILABLE");
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return fail("STORAGE_UNAVAILABLE");
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return fail("STORAGE_UNAVAILABLE");
  }
}

function credential(value: string | undefined) {
  if (!value || value !== value.trim() || /[\r\n]/.test(value)) return fail("STORAGE_UNAVAILABLE");
  return value;
}

function pathSegments(path: string) {
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || !/^[a-zA-Z0-9._ -]+$/.test(part))) {
    return fail("STORAGE_INVALID_SCOPE");
  }
  return segments;
}

function objectUrl(base: string, bucket: string, path: string) {
  const encoded = [bucket, ...pathSegments(path)].map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/${encoded}`;
}

function objectError(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("STORAGE_INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

function isMissingObject(status: number, body: Record<string, unknown>) {
  return body.code === "NoSuchKey" && (status === 404 || (status === 400 && String(body.statusCode) === "404"));
}

function isUploadConflict(status: number, body: Record<string, unknown>) {
  const typed = body.code === "ResourceAlreadyExists" || body.code === "KeyAlreadyExists";
  const legacy = body.error === "Duplicate" && body.message === "The resource already exists";
  return (status === 409 && typed) || (status === 400 && String(body.statusCode) === "409" && (typed || legacy));
}

export function createSourceReferenceStorage(input: FactoryInput<SourceReferencePreparationAuthorization>): Promise<SourceReferenceStoragePreparer>;
export function createSourceReferenceStorage(input: FactoryInput<SourceReferenceReadAuthorization>): Promise<SourceReferenceStorageReader>;
export async function createSourceReferenceStorage({ context, authorization, signal: callerSignal }: FactoryInput<SourceReferenceStorageAuthorization>): Promise<SourceReferenceStoragePreparer | SourceReferenceStorageReader> {
  const startedAt = performance.now();
  const parsed = authorizationSchema.safeParse(authorization);
  if (!parsed.success) return fail("STORAGE_INVALID_SCOPE");
  const access = parsed.data;
  if (access.actorId !== context.userId.toLowerCase() || access.tenantId !== context.tenantId.toLowerCase()) {
    return fail("STORAGE_ACCESS_DENIED");
  }
  const privatePath = `${access.tenantId}/${access.projectId}/${access.versionId}/${access.copyId}/reference.pdf`;
  if (access.destinationLocator.bucket !== "estimate-source-references" || access.destinationLocator.path !== privatePath) {
    return fail("STORAGE_INVALID_SCOPE");
  }
  let sourcePath: string | undefined;
  if (access.purpose === "prepare") {
    if (!["admin", "engineer"].includes(context.tenantRole)) return fail("STORAGE_ACCESS_DENIED");
    const reservation = access.reservation;
    const segments = pathSegments(reservation.source_locator.path);
    const prefix = [access.tenantId, access.projectId, access.uploadId, access.documentId];
    if (reservation.copy_id !== access.copyId || reservation.version_id !== access.versionId ||
        reservation.destination_locator.bucket !== "estimate-source-references" || reservation.destination_locator.path !== privatePath ||
        reservation.source_locator.bucket !== "affaire-intake" || segments.length !== 5 || prefix.some((part, index) => part !== segments[index])) {
      return fail("STORAGE_INVALID_SCOPE");
    }
    sourcePath = reservation.source_locator.path;
  }

  const deadline = startedAt + (access.purpose === "prepare" ? 60_000 : 30_000);
  const timeoutSignal = AbortSignal.timeout(Math.max(0, Math.ceil(deadline - performance.now())));
  const controller = new AbortController();
  const signal = AbortSignal.any([timeoutSignal, controller.signal, ...(callerSignal ? [callerSignal] : [])]);
  function checkBudget() {
    if (callerSignal?.aborted) return fail("STORAGE_ABORTED");
    if (timeoutSignal.aborted || performance.now() >= deadline) return fail("STORAGE_TIMEOUT");
    if (controller.signal.aborted) return fail("STORAGE_ABORTED");
  }
  async function boundedWait<T>(task: Promise<T>): Promise<T> {
    checkBudget();
    return new Promise<T>((resolve, reject) => {
      const aborted = () => { try { checkBudget(); } catch (error) { reject(error); } };
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      task.then((value) => {
        try { checkBudget(); resolve(value); } catch (error) { reject(error); }
      }, reject).finally(() => signal.removeEventListener("abort", aborted));
    });
  }
  async function currentCopy() {
    checkBudget();
    const review = await boundedWait(readSourceReferenceReview({ versionId: access.versionId, copyId: access.copyId }, { signal }));
    if (review.projectId !== access.projectId || review.versionId !== access.versionId || review.selectedCopy?.copyId !== access.copyId) {
      return fail("STORAGE_ACCESS_DENIED");
    }
    return review.selectedCopy;
  }
  async function requirePending() {
    if (access.purpose !== "prepare" || (await currentCopy()).state !== "pending") return fail("STORAGE_ACCESS_DENIED");
  }

  // A caller-created authorization object cannot grant service access on its own.
  const copy = await currentCopy();
  if (access.purpose !== "prepare" && copy.state !== "verified") return fail("STORAGE_ACCESS_DENIED");
  const base = configuredBase();
  const privateUrl = objectUrl(base, "estimate-source-references", privatePath);
  const publicKey = credential(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  let userToken: string;
  try {
    const session = await boundedWait(context.supabase.auth.getSession());
    if (session.error || !session.data.session?.access_token || session.data.session.user.id.toLowerCase() !== access.actorId) return fail("STORAGE_ACCESS_DENIED");
    const token = session.data.session.access_token;
    const verified = await boundedWait(context.supabase.auth.getUser(token));
    if (verified.error || verified.data.user?.id.toLowerCase() !== access.actorId) return fail("STORAGE_ACCESS_DENIED");
    userToken = credential(token);
  } catch (error) {
    if (error instanceof SourceReferenceStorageError) throw error;
    return fail("STORAGE_ACCESS_DENIED");
  }
  const serviceKey = credential(process.env.SUPABASE_SERVICE_ROLE_KEY);

  async function readBounded(response: Response, limit: number, tooLarge: keyof typeof MESSAGES) {
    if (!response.body) return fail("STORAGE_INVALID_RESPONSE");
    const reader = response.body.getReader();
    const buffer = new ArrayBuffer(0, { maxByteLength: limit });
    let length = 0;
    try {
      while (true) {
        checkBudget();
        const chunk = await reader.read();
        checkBudget();
        if (chunk.done) return buffer.transferToFixedLength(length);
        if (!(chunk.value instanceof Uint8Array)) return fail("STORAGE_INVALID_RESPONSE");
        if (chunk.value.byteLength > limit - length) return fail(tooLarge);
        const required = length + chunk.value.byteLength;
        if (buffer.byteLength < required) buffer.resize(Math.min(limit, Math.max(required, buffer.byteLength * 2, 65536)));
        new Uint8Array(buffer, length, chunk.value.byteLength).set(chunk.value);
        length = required;
      }
    } catch (error) {
      let failure: SourceReferenceStorageError;
      if (error instanceof SourceReferenceStorageError) failure = error;
      else {
        failure = new SourceReferenceStorageError("STORAGE_UNAVAILABLE");
        try { checkBudget(); } catch (budgetError) {
          if (budgetError instanceof SourceReferenceStorageError) failure = budgetError;
        }
      }
      controller.abort();
      await reader.cancel().catch(() => undefined);
      throw failure;
    } finally {
      reader.releaseLock();
    }
  }
  async function controlBody(response: Response) {
    const bytes = await readBounded(response, MAX_CONTROL_BYTES, "STORAGE_INVALID_RESPONSE");
    try { return objectError(JSON.parse(new TextDecoder().decode(bytes))); }
    catch { return fail("STORAGE_INVALID_RESPONSE"); }
  }
  async function request(url: string, service: boolean, body?: ArrayBuffer) {
    checkBudget();
    try {
      const key = service ? serviceKey : publicKey;
      const token = service ? serviceKey : userToken;
      const response = await fetch(url, {
        method: body ? "POST" : "GET", body, redirect: "error", cache: "no-store", signal,
        headers: { apikey: key, Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/pdf", "x-upsert": "false", "cache-control": "max-age=0" } : {}) },
      });
      checkBudget();
      return response;
    } catch (error) {
      if (error instanceof SourceReferenceStorageError) { controller.abort(); throw error; }
      checkBudget();
      return fail("STORAGE_UNAVAILABLE");
    }
  }
  async function download(url: string, service: boolean): Promise<ArrayBuffer | null> {
    const response = await request(url, service);
    if (response.status === 200) {
      const bytes = await readBounded(response, MAX_BYTES, "STORAGE_TOO_LARGE");
      if (!bytes.byteLength) return fail("STORAGE_INVALID_RESPONSE");
      return bytes;
    }
    const body = await controlBody(response);
    if (isMissingObject(response.status, body)) return null;
    if (response.status === 401 || response.status === 403 || body.code === "AccessDenied" || body.code === "InvalidJWT") return fail("STORAGE_ACCESS_DENIED");
    return fail("STORAGE_UNAVAILABLE");
  }
  async function readCopy() {
    await currentCopy();
    const bytes = await download(privateUrl, true);
    if (bytes === null && (access.purpose !== "prepare" || (await currentCopy()).state !== "pending")) return fail("STORAGE_SOURCE_UNAVAILABLE");
    return bytes;
  }
  if (access.purpose !== "prepare") {
    return { readCopy: async () => { const bytes = await readCopy(); if (bytes === null) return fail("STORAGE_SOURCE_UNAVAILABLE"); return bytes; } };
  }
  return {
    readCopy,
    async readSource() {
      await requirePending();
      const bytes = await download(objectUrl(base, "affaire-intake", sourcePath!), false);
      if (bytes === null) return fail("STORAGE_SOURCE_UNAVAILABLE");
      return bytes;
    },
    async uploadCopy(pdf) {
      await requirePending();
      if (!(pdf.bytes instanceof ArrayBuffer) || pdf.bytes.byteLength < 1 || pdf.bytes.byteLength > MAX_BYTES ||
          pdf.byteSize !== pdf.bytes.byteLength || !Number.isSafeInteger(pdf.pageCount) || pdf.pageCount < 1 || pdf.pageCount > 200) {
        return fail("STORAGE_INVALID_RESPONSE");
      }
      const response = await request(privateUrl, true, pdf.bytes);
      const body = await controlBody(response);
      if (isUploadConflict(response.status, body)) return "conflict";
      if (response.status === 401 || response.status === 403 || body.code === "AccessDenied") return fail("STORAGE_ACCESS_DENIED");
      if (!response.ok) return fail("STORAGE_UNAVAILABLE");
      if (body.Key !== `estimate-source-references/${privatePath}` || typeof body.Id !== "string" || !z.string().uuid().safeParse(body.Id).success) return fail("STORAGE_INVALID_RESPONSE");
      return "created";
    },
  };
}
