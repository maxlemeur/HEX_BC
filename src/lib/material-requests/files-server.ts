import { randomUUID } from "node:crypto";

import { sanitizeAffaireIntakeFilename } from "@/lib/affaires/intake";
import {
  badRequest,
  conflict,
  internalError,
  mapSupabaseError,
  notFound,
  payloadTooLarge,
  unprocessableEntity,
} from "@/lib/estimates/errors";

import {
  MATERIAL_REQUEST_FILE_EXTENSIONS,
  MATERIAL_REQUEST_FILE_MAX_BYTES,
  MATERIAL_REQUEST_FILE_MIME_TYPES,
  MATERIAL_REQUEST_FILE_REJECTED,
  MATERIAL_REQUEST_MAX_FILES,
  MATERIAL_REQUESTS_BUCKET,
  type MaterialRequestFile,
  type MaterialRequestFileRejection,
  type MaterialRequestFileRotation,
  type MaterialRequestFileUploads,
} from "./contracts";
import {
  MATERIAL_REQUEST_QUOTE_FILE_LIMIT,
  MATERIAL_REQUEST_QUOTE_MAX_FILES,
} from "./quote-contracts";
import { quoteReadOnly, requireOpenQuote, requireQuote } from "./quotes-server";
import { FILE_COLUMNS, requireProjectAccess, requireRequest, type MaterialRequestAccess } from "./server-shared";

/**
 * The originals of a request (TI-690): photographs of paper and screenshots of messages, kept beside
 * the lines. Their bytes never pass through the application, whose request bodies are capped far below
 * a phone photo (10 MB by the proxy, 4.5 MB by the host): the browser sends them straight to storage.
 *
 *  1. prepare: what the browser announces is checked, a row is recorded for each photo (the storage
 *     policy admits an object only beside the row that names its path) and an upload is signed for it,
 *     with the caller's own client, never the service role, never as an upsert;
 *  2. the browser uploads to the signed URL;
 *  3. complete: what storage really holds is checked against what was announced (present, same size,
 *     bytes of the announced image type), and only then is the batch marked `stored_at`.
 *
 * An original exists for a reader only once it is marked: until then, and for good if the upload is
 * abandoned, nothing lists, counts or serves it. Bytes are read back through the application only, and
 * never rewritten.
 *
 * Leaving is the mirror image: a row is withdrawn (`removed_at`) before its bytes go, then deleted. The
 * database refuses an upload at the path of a withdrawn or stored row, so a signed upload still in
 * flight cannot land after its photo was cancelled, rejected or discarded, and it refuses to delete
 * the object of a row that is still listed: a listed original always has its bytes.
 *
 * TI-691: the files of a quote (the supplier's answer) go the same way, with `quote_id`: a PDF or images, ten per
 * quote apart from the twelve originals, attached and removed only while the quote is requested or received.
 */

export const MATERIAL_REQUEST_HEIC_UNSUPPORTED = "MATERIAL_REQUEST_HEIC_UNSUPPORTED";
export const MATERIAL_REQUEST_FILE_LIMIT = "MATERIAL_REQUEST_FILE_LIMIT";
export const MATERIAL_REQUEST_UPLOADS_PENDING = "MATERIAL_REQUEST_UPLOADS_PENDING";
export const MATERIAL_REQUEST_UPLOAD_CHANGED = "MATERIAL_REQUEST_UPLOAD_CHANGED";
/**
 * Photos waiting for their bytes on one request: two full batches in flight. The database holds the same
 * bound, and the cap of twelve listed originals, in the file trigger.
 */
export const MATERIAL_REQUEST_MAX_PENDING_FILES = 2 * MATERIAL_REQUEST_MAX_FILES;
/**
 * The screen converts a HEIC photo to JPEG before sending it, so only a caller that skipped that step
 * (the API used directly) meets this refusal: the bucket stores JPEG, PNG and WebP only.
 */
export const MATERIAL_REQUEST_HEIC_MESSAGE =
  "Les photos HEIC doivent être converties en JPEG avant l’envoi : l’écran des demandes le fait de lui-même.";

const FILE_NOT_FOUND_MESSAGE = "Original introuvable dans cette demande.";
const PREPARE_FAILED_MESSAGE = "Impossible de préparer l’envoi des photos. Réessayez.";
const COMPLETE_FAILED_MESSAGE = "Impossible d’enregistrer les photos : aucune n’a été conservée. Réessayez.";
const REJECTED_MESSAGE = "Les photos reçues ne sont pas celles annoncées : aucune n’a été conservée. Déposez-les à nouveau.";
/** A signed upload is valid for two hours: an unstored row older than this belongs to nobody's upload. */
const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;

type ImageMimeType = (typeof MATERIAL_REQUEST_FILE_MIME_TYPES)[number];
type StoredMimeType = ImageMimeType | "application/pdf";
/** What a batch is: originals of the request (images), or the answer to one quote (PDF or images). */
type FileScope = { quoteId: string | null };

const MIME_BY_EXTENSION: Record<(typeof MATERIAL_REQUEST_FILE_EXTENSIONS)[number], ImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const HEIC_EXTENSIONS = new Set(["heic", "heif", "heics", "heifs"]);
const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);
const MAX_SIZE_LABEL = `${MATERIAL_REQUEST_FILE_MAX_BYTES / (1024 * 1024)} Mo`;
const HEAD_BYTES = 16;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).trim().toLowerCase() : "";
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** What the first bytes say the file is, whatever its name and declared type claim. */
function sniffImage(head: Uint8Array): StoredMimeType | "heic" | null {
  if (ascii(head, 0, 5) === "%PDF-") return "application/pdf";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "image/webp";
  if (ascii(head, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(head, 8, 12))) return "heic";
  return null;
}

/**
 * What is announced must be a JPEG, PNG or WebP of at most 20 MiB, whose name and type agree; or, for a quote, also
 * a PDF.
 */
function checkAnnounced(file: { name: string; mime_type: string; byte_size: number }, scope: FileScope): StoredMimeType {
  const extension = extensionOf(file.name);
  const declared = file.mime_type.trim().toLowerCase();
  if (HEIC_EXTENSIONS.has(extension) || HEIC_MIME_TYPES.has(declared)) {
    throw unprocessableEntity(MATERIAL_REQUEST_HEIC_MESSAGE, undefined, MATERIAL_REQUEST_HEIC_UNSUPPORTED);
  }
  const forQuote = scope.quoteId !== null;
  const expected: StoredMimeType | undefined = forQuote && extension === "pdf"
    ? "application/pdf"
    : (MIME_BY_EXTENSION as Record<string, ImageMimeType | undefined>)[extension];
  if (!expected) {
    throw badRequest(forQuote
      ? `« ${file.name} » n’est pas un PDF ni une image JPEG, PNG ou WebP.`
      : `« ${file.name} » n’est pas une image JPEG, PNG ou WebP.`);
  }
  // A browser that does not know the type sends none: the extension then decides.
  if (declared && declared !== expected) {
    throw badRequest(forQuote
      ? `« ${file.name} » n’est pas le fichier que son nom annonce : déposez un PDF ou une image JPEG, PNG ou WebP.`
      : `« ${file.name} » n’est pas l’image que son nom annonce : déposez un fichier JPEG, PNG ou WebP.`);
  }
  if (file.byte_size > MATERIAL_REQUEST_FILE_MAX_BYTES) throw payloadTooLarge(`« ${file.name} » dépasse ${MAX_SIZE_LABEL}.`);
  return expected;
}

/**
 * Withdraws rows, then removes their bytes; the caller deletes the rows (or their request) afterwards.
 * In that order because the database refuses an upload at the path of a withdrawn row: a signed upload
 * still in flight cannot land once this has run, and whatever landed before is removed here.
 */
async function withdraw(
  access: MaterialRequestAccess,
  scope: { requestId: string; ids?: readonly string[]; unstoredOnly?: boolean },
): Promise<{ ids: string[]; storageError: unknown }> {
  const { supabase, tenantId } = access.context;
  let statement = supabase
    .from("material_request_files")
    .update({ removed_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", scope.requestId);
  if (scope.ids) statement = statement.in("id", [...scope.ids]);
  // Never a photo that became visible in the meantime: only what is still waiting for its bytes.
  if (scope.unstoredOnly) statement = statement.is("stored_at", null);
  const { data, error } = await statement.select("id, storage_path");
  if (error) throw mapSupabaseError(error, "Impossible de retirer les originaux.");
  const withdrawn = data ?? [];
  if (withdrawn.length === 0) return { ids: [], storageError: null };
  const { error: storageError } = await supabase.storage
    .from(MATERIAL_REQUESTS_BUCKET)
    .remove(withdrawn.map((file) => file.storage_path));
  return { ids: withdrawn.map((file) => file.id), storageError };
}

/** Best effort: photos that never became visible are taken back, rows and whatever bytes reached storage. */
async function discardUnstored(access: MaterialRequestAccess, requestId: string, ids: readonly string[]) {
  if (ids.length === 0) return;
  try {
    const { ids: withdrawn, storageError } = await withdraw(access, { requestId, ids, unstoredOnly: true });
    if (storageError) throw storageError;
    if (withdrawn.length === 0) return;
    const { error } = await access.context.supabase
      .from("material_request_files")
      .delete()
      .in("id", withdrawn)
      .eq("tenant_id", access.context.tenantId)
      .eq("project_id", access.project.id)
      .eq("request_id", requestId);
    if (error) throw error;
  } catch (error) {
    // Withdrawn rows stay invisible; the next preparation on this request finishes the job.
    console.error("Unstored material request originals could not be discarded", { requestId, error });
  }
}

/**
 * What earlier uploads and deletions left unfinished on this request: photos never completed whose signed
 * URLs have expired, and rows withdrawn whose deletion did not finish.
 */
async function discardLeftovers(access: MaterialRequestAccess, requestId: string) {
  const { data, error } = await access.context.supabase
    .from("material_request_files")
    .select("id, storage_path, created_at, stored_at, removed_at")
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId);
  if (error) {
    console.error("Unfinished material request originals could not be listed", { requestId, error });
    return;
  }
  const limit = Date.now() - ABANDONED_AFTER_MS;
  const abandoned = (data ?? []).filter((file) => file.removed_at === null && file.stored_at === null && Date.parse(file.created_at) < limit);
  await discardUnstored(access, requestId, abandoned.map((file) => file.id));

  const halfDeleted = (data ?? []).filter((file) => file.removed_at !== null);
  if (halfDeleted.length === 0) return;
  const { error: storageError } = await access.context.supabase.storage
    .from(MATERIAL_REQUESTS_BUCKET)
    .remove(halfDeleted.map((file) => file.storage_path));
  const { error: rowsError } = storageError
    ? { error: null }
    : await access.context.supabase
      .from("material_request_files")
      .delete()
      .in("id", halfDeleted.map((file) => file.id))
      .eq("tenant_id", access.context.tenantId)
      .eq("project_id", access.project.id)
      .eq("request_id", requestId)
      .not("removed_at", "is", null);
  if (storageError || rowsError) {
    console.error("Withdrawn material request originals could not be deleted", { requestId, storageError, rowsError });
  }
}

/** Every original of a request, withdrawn and without its bytes: the request can then be deleted. */
export async function removeRequestOriginals(access: MaterialRequestAccess, requestId: string) {
  const { storageError } = await withdraw(access, { requestId });
  if (storageError) {
    console.error("Material request originals could not be removed", { requestId, error: storageError });
    throw internalError("Impossible de supprimer les originaux de la demande.");
  }
}

function fileLimitReached(stored: number, suffix = "") {
  return unprocessableEntity(
    `Une demande garde ${MATERIAL_REQUEST_MAX_FILES} originaux au plus (${stored} déjà déposés)${suffix}.`,
    { max: MATERIAL_REQUEST_MAX_FILES, existing: stored },
    MATERIAL_REQUEST_FILE_LIMIT,
  );
}

function quoteFileLimitReached(stored: number, suffix = "") {
  return unprocessableEntity(
    `Un devis garde ${MATERIAL_REQUEST_QUOTE_MAX_FILES} fichiers au plus (${stored} déjà déposés)${suffix}.`,
    { max: MATERIAL_REQUEST_QUOTE_MAX_FILES, existing: stored },
    MATERIAL_REQUEST_QUOTE_FILE_LIMIT,
  );
}

function limitReached(scope: FileScope, stored: number, suffix = "") {
  return scope.quoteId === null ? fileLimitReached(stored, suffix) : quoteFileLimitReached(stored, suffix);
}

/** The end of a cap refusal at completion: the batch was discarded. */
const NOT_KEPT = { originals: " : ces photos n’ont pas été conservées", quote: " : ces fichiers n’ont pas été conservés" };

function capOf(scope: FileScope) {
  return scope.quoteId === null ? MATERIAL_REQUEST_MAX_FILES : MATERIAL_REQUEST_QUOTE_MAX_FILES;
}

function tooManyPending() {
  return unprocessableEntity(
    `Trop de photos sont en cours d’envoi pour cette demande (${MATERIAL_REQUEST_MAX_PENDING_FILES} au plus) : terminez ou annulez les envois en cours, puis réessayez.`,
    { max: MATERIAL_REQUEST_MAX_PENDING_FILES },
    MATERIAL_REQUEST_UPLOADS_PENDING,
  );
}

/**
 * The files of a request by what a reader sees of them: listed in this scope (the originals, or one quote's files),
 * and waiting for their bytes on the whole request (the bound the database holds per request).
 */
async function countFiles(
  access: MaterialRequestAccess,
  requestId: string,
  scope: FileScope,
): Promise<{ listed: number; pending: number }> {
  const { data, error } = await access.context.supabase
    .from("material_request_files")
    .select("id, quote_id, stored_at")
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .is("removed_at", null);
  if (error) throw mapSupabaseError(error, "Impossible de charger les originaux de la demande.");
  const rows = data ?? [];
  return {
    listed: rows.filter((file) => file.stored_at !== null && (file.quote_id ?? null) === scope.quoteId).length,
    pending: rows.filter((file) => file.stored_at === null).length,
  };
}

export async function prepareMaterialRequestFiles(
  projectId: string,
  requestId: string,
  announced: ReadonlyArray<{ name: string; mime_type: string; byte_size: number }>,
  quoteId?: string,
): Promise<MaterialRequestFileUploads> {
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  const request = await requireRequest(access, requestId);
  // A quote's answer goes to a quote of this request still in progress (404, 409 otherwise).
  const scope: FileScope = { quoteId: quoteId ? (await requireOpenQuote(access, request.id, quoteId)).id : null };

  // Every photo is checked before anything is written: one refusal refuses the batch.
  const mimeTypes = announced.map((file) => checkAnnounced(file, scope));
  await discardLeftovers(access, request.id);

  // The cap is on what a reader sees: it is checked again where a batch becomes visible. Photos still
  // waiting for their bytes are bounded apart, so that preparing cannot pile up rows and signed uploads.
  const { listed, pending } = await countFiles(access, request.id, scope);
  if (listed + announced.length > capOf(scope)) throw limitReached(scope, listed);
  if (pending + announced.length > MATERIAL_REQUEST_MAX_PENDING_FILES) throw tooManyPending();

  const recorded: string[] = [];
  const uploads: MaterialRequestFileUploads["uploads"] = [];
  try {
    for (const [index, photo] of announced.entries()) {
      const id = randomUUID();
      const path = [context.tenantId, access.project.id, request.id, id, sanitizeAffaireIntakeFilename(photo.name)].join("/");
      const file = { id, file_name: photo.name, mime_type: mimeTypes[index], byte_size: photo.byte_size };
      // The row first, not visible yet: storage signs an upload only beside the row that names its path.
      const { error } = await context.supabase.from("material_request_files").insert({
        ...file,
        project_id: access.project.id,
        request_id: request.id,
        quote_id: scope.quoteId,
        storage_path: path,
        created_by: context.userId,
      });
      if (error) {
        if (error.message === MATERIAL_REQUEST_UPLOADS_PENDING) throw tooManyPending();
        // The quote was retained or closed by another session since it was read.
        if (error.message === "MATERIAL_REQUEST_QUOTE_READ_ONLY" && scope.quoteId) {
          const quote = await requireQuote(access, request.id, scope.quoteId);
          if (quote.status === "retained" || quote.status === "closed") throw quoteReadOnly(quote.status);
        }
        throw mapSupabaseError(error, "Impossible d'enregistrer la photo.");
      }
      recorded.push(id);

      // With the caller's own client: the storage INSERT policy is evaluated for them, here.
      const { data: signed, error: signError } = await context.supabase.storage
        .from(MATERIAL_REQUESTS_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (signError || !signed?.token) {
        console.error("Material request upload could not be signed", { requestId: request.id, error: signError });
        throw internalError(PREPARE_FAILED_MESSAGE);
      }
      uploads.push({ file, path, token: signed.token });
    }
  } catch (error) {
    await discardUnstored(access, request.id, recorded);
    throw error;
  }
  return { uploads };
}

async function readHead(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const head = new Uint8Array(HEAD_BYTES);
  let length = 0;
  try {
    while (length < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, HEAD_BYTES - length);
      head.set(part, length);
      length += part.byteLength;
    }
  } finally {
    // The rest of the photo is not needed: stop the download, without waiting for it. When the first
    // read already returned the whole body (a small photo), the cancellation of that stream never
    // settles on this runtime, and the check, then the whole request, would wait for ever.
    void reader.cancel().catch(() => undefined);
  }
  return head.subarray(0, length);
}

/** Null when storage holds, at the path of the row, what the row announces. */
async function verifyStored(
  access: MaterialRequestAccess,
  file: { storage_path: string; mime_type: string; byte_size: number },
): Promise<MaterialRequestFileRejection["reason"] | null> {
  const bucket = access.context.supabase.storage.from(MATERIAL_REQUESTS_BUCKET);
  const { data: info, error: infoError } = await bucket.info(file.storage_path);
  if (infoError || !info) return "missing";
  if (info.size !== file.byte_size) return "size";
  const { data: stream, error: streamError } = await bucket.download(file.storage_path).asStream();
  if (streamError || !stream) return "missing";
  return sniffImage(await readHead(stream as ReadableStream<Uint8Array>)) === file.mime_type ? null : "type";
}

export async function completeMaterialRequestFiles(
  projectId: string,
  requestId: string,
  ids: readonly string[],
): Promise<{ files: MaterialRequestFile[] }> {
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  const wanted = [...new Set(ids)];
  // A photo whose deletion has begun is not found.
  const { data: rows, error } = await context.supabase
    .from("material_request_files")
    .select("id, quote_id, storage_path, mime_type, byte_size, stored_at")
    .in("id", wanted)
    .eq("tenant_id", context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .is("removed_at", null);
  if (error) throw mapSupabaseError(error, "Impossible de charger les originaux de la demande.");
  if ((rows ?? []).length !== wanted.length) throw notFound(FILE_NOT_FOUND_MESSAGE);

  // A photo that is already stored is not looked at again, and never discarded: whatever goes wrong
  // below, only what is still waiting for its bytes is taken back.
  const pending = rows.filter((row) => row.stored_at === null);
  const pendingIds = pending.map((file) => file.id);
  const rejected: MaterialRequestFileRejection[] = [];
  for (const file of pending) {
    const reason = await verifyStored(access, file);
    if (reason) rejected.push({ id: file.id, reason });
  }
  if (rejected.length > 0) {
    // All or nothing: one photo that is not what was announced, and none of the batch is kept.
    await discardUnstored(access, requestId, pendingIds);
    throw unprocessableEntity(REJECTED_MESSAGE, { rejected }, MATERIAL_REQUEST_FILE_REJECTED);
  }

  if (pending.length > 0) {
    // The cap holds where a batch becomes visible: two uploads prepared side by side cannot both pass.
    // The database refuses it too, should they complete at the very same time. Originals and each quote's
    // files are counted apart.
    const scopes = [...new Set(pending.map((file) => file.quote_id ?? null))].map((quoteId): FileScope => ({ quoteId }));
    const counted = await Promise.all(scopes.map(async (scope) => ({
      scope,
      listed: (await countFiles(access, requestId, scope)).listed,
      adding: pending.filter((file) => (file.quote_id ?? null) === scope.quoteId).length,
    })));
    const over = counted.find((entry) => entry.listed + entry.adding > capOf(entry.scope));
    if (over) {
      await discardUnstored(access, requestId, pendingIds);
      throw limitReached(over.scope, over.listed, NOT_KEPT[over.scope.quoteId === null ? "originals" : "quote"]);
    }

    // One statement makes the whole batch visible. The database sets the time itself and refuses the
    // mark for a path that does not hold bytes of the announced size.
    const { data: marked, error: markError } = await context.supabase
      .from("material_request_files")
      .update({ stored_at: new Date().toISOString() })
      .in("id", pendingIds)
      .eq("tenant_id", context.tenantId)
      .eq("project_id", access.project.id)
      .eq("request_id", requestId)
      .is("removed_at", null)
      .select("id");
    if (markError) {
      // Nothing was marked: the statement failed as a whole.
      await discardUnstored(access, requestId, pendingIds);
      if (markError.message === MATERIAL_REQUEST_FILE_LIMIT) {
        const originals = counted.find((entry) => entry.scope.quoteId === null);
        throw fileLimitReached(originals?.listed ?? MATERIAL_REQUEST_MAX_FILES, NOT_KEPT.originals);
      }
      if (markError.message === MATERIAL_REQUEST_QUOTE_FILE_LIMIT) {
        const quote = counted.find((entry) => entry.scope.quoteId !== null);
        throw quoteFileLimitReached(quote?.listed ?? MATERIAL_REQUEST_QUOTE_MAX_FILES, NOT_KEPT.quote);
      }
      console.error("Material request originals could not be marked stored", { requestId, error: markError });
      throw internalError(COMPLETE_FAILED_MESSAGE);
    }
    if ((marked ?? []).length !== pending.length) {
      // Another session cancelled part of the batch meanwhile. What was marked is visible and keeps
      // its bytes; only what is still unstored is taken back.
      await discardUnstored(access, requestId, pendingIds);
      throw conflict(
        "Ce dépôt a été modifié pendant son enregistrement : rechargez la demande, puis déposez à nouveau les photos manquantes.",
        undefined,
        MATERIAL_REQUEST_UPLOAD_CHANGED,
      );
    }
  }

  const { data: files, error: filesError } = await context.supabase
    .from("material_request_files")
    .select(FILE_COLUMNS)
    .in("id", wanted)
    .eq("tenant_id", context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .not("stored_at", "is", null)
    .is("removed_at", null);
  if (filesError) throw mapSupabaseError(filesError, "Impossible de charger les originaux de la demande.");
  // In the order they were named.
  const byId = new Map((files ?? []).map((file) => [file.id, file]));
  return { files: wanted.flatMap((id) => byId.get(id) ?? []) };
}

/** A row of this request, stored or not: only deletion looks at one that is not. */
async function requireFile(access: MaterialRequestAccess, requestId: string, fileId: string) {
  const { data, error } = await access.context.supabase
    .from("material_request_files")
    .select("id, quote_id, storage_path, file_name, mime_type, stored_at, removed_at")
    .eq("id", fileId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger cet original.");
  if (!data) throw notFound(FILE_NOT_FOUND_MESSAGE);
  return data;
}

export async function readMaterialRequestFile(
  projectId: string,
  requestId: string,
  fileId: string,
): Promise<{ body: Blob; mimeType: string; fileName: string }> {
  const access = await requireProjectAccess(projectId, "read");
  const file = await requireFile(access, requestId, fileId);
  // Not stored (yet, or ever), or on its way out: there is nothing to serve, and storage is not asked.
  if (file.stored_at === null || file.removed_at !== null) throw notFound(FILE_NOT_FOUND_MESSAGE);
  const { data, error } = await access.context.supabase.storage.from(MATERIAL_REQUESTS_BUCKET).download(file.storage_path);
  if (error || !data) {
    console.error("Material request original could not be read", { fileId, error });
    throw internalError("Impossible de récupérer cet original.");
  }
  // The type recorded and verified at upload, never the one storage or the browser would guess.
  return { body: data, mimeType: file.mime_type, fileName: file.file_name };
}

export async function updateMaterialRequestFile(
  projectId: string,
  requestId: string,
  fileId: string,
  input: { rotation: MaterialRequestFileRotation },
): Promise<{ file: MaterialRequestFile }> {
  const access = await requireProjectAccess(projectId, "write");
  const { data, error } = await access.context.supabase
    .from("material_request_files")
    .update({ rotation: input.rotation })
    .eq("id", fileId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .not("stored_at", "is", null)
    .is("removed_at", null)
    .select(FILE_COLUMNS)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible d'enregistrer la rotation.");
  if (!data) throw notFound(FILE_NOT_FOUND_MESSAGE);
  return { file: data };
}

/**
 * Also the way an upload is cancelled: a row that is not stored yet is deleted like any other. Withdrawn
 * first: the original leaves every reader at once and no upload can land at its path any more; then
 * its bytes; then the row. Interrupted, it leaves an invisible row that this same call, or the next
 * preparation on the request, finishes deleting.
 */
export async function deleteMaterialRequestFile(
  projectId: string,
  requestId: string,
  fileId: string,
): Promise<{ deleted: true }> {
  const access = await requireProjectAccess(projectId, "write");
  const file = await requireFile(access, requestId, fileId);
  // TI-691: a quote's answer stays once the quote is retained or closed; while it is in progress, a file attached by
  // mistake is removed like an original.
  if (file.quote_id) await requireOpenQuote(access, requestId, file.quote_id);
  const { storageError } = await withdraw(access, { requestId, ids: [file.id] });
  if (storageError) {
    console.error("Material request original could not be removed", { fileId, error: storageError });
    throw internalError("Impossible de supprimer cet original.");
  }
  const { error } = await access.context.supabase
    .from("material_request_files")
    .delete()
    .eq("id", file.id)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId);
  if (error) throw mapSupabaseError(error, "Impossible de supprimer cet original.");
  return { deleted: true };
}
