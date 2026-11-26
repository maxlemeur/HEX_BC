import "server-only";

import { PDFDocument } from "pdf-lib";

import { isApiKeyError } from "@/lib/ai/access/api-key-errors";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { LocalChatGptOverrideUnavailableError } from "@/lib/ai/chatgpt-local-inference";
import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { ApiError, internalError, mapSupabaseError, notFound, payloadTooLarge, unprocessableEntity } from "@/lib/http/api-response";

import {
  MATERIAL_REQUEST_FILE_MIME_TYPES,
  MATERIAL_REQUESTS_BUCKET,
  type MaterialRequestFileRotation,
} from "./contracts";
import {
  MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_PROMPT_VERSION,
  MATERIAL_REQUEST_PHOTO_API_CEILING_NANO_USD,
  MATERIAL_REQUEST_PHOTO_TOO_LARGE,
  MATERIAL_REQUEST_PHOTO_UNREADABLE,
  buildMaterialRequestPhotoPrompt,
  draftsFromPhotoAnswer,
  materialRequestPhotoAnswerSchema,
  type MaterialRequestPhotoAnalysis,
  type MaterialRequestPhotoAnalysisAvailability,
  type MaterialRequestPhotoAnalysisInput,
} from "./photo-analysis";
import {
  getMaterialRequestPhotoAnalysisAvailability,
  MATERIAL_REQUEST_ANALYSIS_DISABLED,
  materialRequestAnalysisModelUnavailable,
  materialRequestAnalysisUnavailable,
  prepareMaterialRequestDocumentAnalysis,
} from "./document-analysis-server";
import { requireProjectAccess, requireRequest } from "./server-shared";

/**
 * The AI reading of one original of a request (photo-analysis.ts says what is asked and what becomes of the answer).
 * The member who can edit the request chooses the billing source in their profile. The screen sends one photo
 * per call, with the model and effort selected for that reading.
 *
 * The reading writes nothing. It answers drafts; the screen adds them through the routes of the lines, which hold
 * the rights, the cap and the refusals of a replacement.
 */

const FILE_NOT_FOUND_MESSAGE = "Original introuvable dans cette demande.";

/** The same for the caller of a request, resolved from their session only where a reading can exist at all. */
export async function readMaterialRequestPhotoAnalysisAvailability(): Promise<MaterialRequestPhotoAnalysisAvailability> {
  if (!isLocalChatGptEnabled()) return MATERIAL_REQUEST_ANALYSIS_DISABLED;
  return getMaterialRequestPhotoAnalysisAvailability(await getAuthenticatedTenantContext());
}

/** The plan's access was lost: the same refusal as before the reading, with the sentence that says what to do. */
const ACCESS_CODES = new Set(["AI_AUTH_REQUIRED", "AI_NOT_CONFIGURED", "AI_LOCAL_DISABLED", "AI_OWNER_INACTIVE"]);

const FAILURE_MESSAGES: Record<string, string> = {
  AI_QUOTA: "La limite du forfait ChatGPT est atteinte : la photo n’a pas été lue. Consultez votre consommation dans Mon profil.",
  AI_RATE_LIMIT: "ChatGPT limite les demandes pour le moment : la photo n’a pas été lue. Réessayez dans quelques minutes.",
  AI_REQUEST_REJECTED:
    "ChatGPT a refusé cette photo, ou le modèle choisi ne lit pas les images. Choisissez un autre modèle ou saisissez les lignes à la main.",
  TIMEOUT: "La lecture de la photo a dépassé son délai. Relancez-la ou réduisez l’effort de raisonnement.",
  INVALID_ANSWER: "L’IA a renvoyé une réponse inexploitable pour cette photo. Relancez la lecture, ou saisissez les lignes à la main.",
  PROVIDER_ERROR:
    "ChatGPT n’a pas terminé la lecture de cette photo. Relancez-la ; si cela se répète, vérifiez la connexion ChatGPT dans Mon profil.",
};
const PDF_FAILURE_MESSAGES: Record<string, string> = {
  AI_QUOTA: "La limite du forfait ChatGPT est atteinte : le PDF n’a pas été lu. Consultez votre consommation dans Mon profil.",
  AI_RATE_LIMIT: "ChatGPT limite les demandes pour le moment : le PDF n’a pas été lu. Réessayez dans quelques minutes.",
  AI_REQUEST_REJECTED:
    "ChatGPT a refusé ce PDF, ou le modèle choisi ne lit pas les PDF. Choisissez un autre modèle ou saisissez les lignes à la main.",
  TIMEOUT: "La lecture du PDF a dépassé son délai. Relancez-la ou réduisez l’effort de raisonnement.",
  INVALID_ANSWER: "L’IA a renvoyé une réponse inexploitable pour ce PDF. Relancez la lecture, ou saisissez les lignes à la main.",
  PROVIDER_ERROR:
    "ChatGPT n’a pas terminé la lecture de ce PDF. Relancez-la ; si cela se répète, vérifiez la connexion ChatGPT dans Mon profil.",
};
/** The plan's token could not be renewed: only a reconnection helps (an unreachable provider is tried again). */
const RECONNECT_MESSAGE = "L’accès ChatGPT n’a pas pu être renouvelé. Reconnectez votre forfait dans Mon profil.";

/** Only this module's sentences and a closed reason cross: nothing the provider or the runtime said. */
function readingFailure(error: unknown, isPdf = false): ApiError {
  if (isApiKeyError(error)) {
    return new ApiError({ status: 503, code: MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED, message: error.message, details: { reason: error.code } });
  }
  if (error instanceof StructuredAiError && ACCESS_CODES.has(error.code)) return materialRequestAnalysisUnavailable(error.message, "unavailable");
  if (error instanceof Error && error.name === "ChatGptSignInError" && (error as { reason?: unknown }).reason === "renewal") {
    return materialRequestAnalysisUnavailable(RECONNECT_MESSAGE, "unavailable");
  }
  const messages = isPdf ? PDF_FAILURE_MESSAGES : FAILURE_MESSAGES;
  const reason = error instanceof StructuredAiError
    ? (error.code in messages ? error.code : "PROVIDER_ERROR")
    : error instanceof Error && error.name === "TimeoutError"
      ? "TIMEOUT"
      : error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")
        ? "INVALID_ANSWER"
        : "PROVIDER_ERROR";
  return new ApiError({
    status: 503,
    code: MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED,
    message: messages[reason],
    details: { reason },
  });
}

export async function analyzeMaterialRequestPhoto(
  projectId: string,
  requestId: string,
  fileId: string,
  settings: MaterialRequestPhotoAnalysisInput = {},
  options?: { signal?: AbortSignal },
): Promise<MaterialRequestPhotoAnalysis> {
  const signal = options?.signal;
  signal?.throwIfAborted();
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  const request = await requireRequest(access, requestId);

  const analyze = await prepareMaterialRequestDocumentAnalysis(context, settings);

  const { data: file, error } = await context.supabase
    .from("material_request_files")
    .select("id, quote_id, storage_path, mime_type, byte_size, rotation, stored_at, removed_at")
    .eq("id", fileId)
    .eq("tenant_id", context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", request.id)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger cet original.");
  // An original of the request that exists for a reader: never a quote's file (a supplier's document), an original
  // whose upload did not finish, or one on its way out.
  if (!file || (file.quote_id ?? null) !== null || file.stored_at === null || (file.removed_at ?? null) !== null) {
    throw notFound(FILE_NOT_FOUND_MESSAGE);
  }
  const mimeType = MATERIAL_REQUEST_FILE_MIME_TYPES.find((type) => type === file.mime_type);
  if (!mimeType) throw notFound(FILE_NOT_FOUND_MESSAGE);
  const isPdf = mimeType === "application/pdf";
  const tooLargeMessage = isPdf
    ? `Ce PDF dépasse ${MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES / (1024 * 1024)} Mo : il est trop lourd pour être lu par l’IA.`
    : `Cette photo dépasse ${MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES / (1024 * 1024)} Mo : elle est trop lourde pour être lue par l’IA.`;
  if (file.byte_size > MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES) {
    throw payloadTooLarge(tooLargeMessage, undefined, MATERIAL_REQUEST_PHOTO_TOO_LARGE);
  }

  signal?.throwIfAborted();
  const { data: bytes, error: downloadError } = await context.supabase.storage
    .from(MATERIAL_REQUESTS_BUCKET)
    .download(file.storage_path);
  if (downloadError || !bytes) {
    console.error("Material request original could not be read for its analysis", { fileId, error: downloadError });
    throw internalError("Impossible de récupérer cet original.");
  }
  if (bytes.size > MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES) {
    throw payloadTooLarge(tooLargeMessage, undefined, MATERIAL_REQUEST_PHOTO_TOO_LARGE);
  }
  const rawBytes = Buffer.from(await bytes.arrayBuffer());
  let pages: number | undefined;
  if (isPdf) {
    try {
      pages = (await PDFDocument.load(rawBytes, { updateMetadata: false })).getPageCount();
    } catch {
      throw unprocessableEntity(
        "Ce PDF ne peut pas être lu. Vérifiez qu’il s’ouvre et qu’il est déverrouillé.",
        undefined,
        MATERIAL_REQUEST_PHOTO_UNREADABLE,
      );
    }
    if (pages === 0) {
      throw unprocessableEntity("Ce PDF ne contient aucune page.", undefined, MATERIAL_REQUEST_PHOTO_UNREADABLE);
    }
  }
  const data = rawBytes.toString("base64");

  signal?.throwIfAborted();
  try {
    const prompt = buildMaterialRequestPhotoPrompt({
      rotation: isPdf ? 0 : (file.rotation as MaterialRequestFileRotation),
      isPdf,
      pages,
    });
    const answer = await analyze({
      prompt,
      schema: materialRequestPhotoAnswerSchema,
      file: { mimeType, data },
      promptVersion: MATERIAL_REQUEST_PHOTO_ANALYSIS_PROMPT_VERSION,
      ceiling: MATERIAL_REQUEST_PHOTO_API_CEILING_NANO_USD,
      signal,
    });
    return { file_id: file.id, lines: draftsFromPhotoAnswer(answer.data), model: answer.model };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    if (cause instanceof LocalChatGptOverrideUnavailableError) {
      throw materialRequestAnalysisModelUnavailable(cause.message);
    }
    const failure = readingFailure(cause, isPdf);
    console.error("Material request photo analysis failed", {
      requestId: request.id,
      fileId: file.id,
      code: failure.code,
      details: failure.details,
    });
    throw failure;
  }
}
