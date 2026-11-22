import "server-only";

import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callStructuredAi, getStructuredAiAvailability } from "@/lib/ai/structured-ai";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { ApiError, conflict, internalError, mapSupabaseError, notFound, payloadTooLarge } from "@/lib/http/api-response";

import {
  MATERIAL_REQUEST_FILE_MIME_TYPES,
  MATERIAL_REQUESTS_BUCKET,
  type MaterialRequestFileRotation,
} from "./contracts";
import {
  MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_PROMPT_VERSION,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE,
  MATERIAL_REQUEST_PHOTO_TOO_LARGE,
  buildMaterialRequestPhotoPrompt,
  draftsFromPhotoAnswer,
  materialRequestPhotoAnswerSchema,
  type MaterialRequestPhotoAnalysis,
  type MaterialRequestPhotoAnalysisAvailability,
} from "./photo-analysis";
import { requireProjectAccess, requireRequest, type MaterialRequestContext } from "./server-shared";

/**
 * The AI reading of one original of a request (photo-analysis.ts says what is asked and what becomes of the answer).
 * It runs on the ChatGPT plan of the member who asks, as every on-demand AI of the application does, so only where
 * that plan can be reached: an instance with the local ChatGPT connection. Only who may write the request may spend
 * a plan on it. One photo per call: the screen reads the photos one after the other and says where it is.
 *
 * The reading writes nothing. It answers drafts; the screen adds them through the routes of the lines, which hold
 * the rights, the cap and the refusals of a replacement.
 */

const DISABLED_MESSAGE =
  "L’analyse IA des photos est indisponible sur cette instance : elle utilise le forfait ChatGPT connecté dans MergeOne en local.";
const UNREADABLE_AVAILABILITY_MESSAGE =
  "La connexion ChatGPT ne peut pas être lue. Reconnectez votre forfait dans Mon profil.";
const FILE_NOT_FOUND_MESSAGE = "Original introuvable dans cette demande.";

/** Whether this member can ask for a reading here: no inference, no provider request. */
export async function getMaterialRequestPhotoAnalysisAvailability(
  context: Pick<MaterialRequestContext, "userId" | "tenantId">,
): Promise<MaterialRequestPhotoAnalysisAvailability> {
  if (!isLocalChatGptEnabled()) return { status: "disabled", message: DISABLED_MESSAGE };
  try {
    const availability = await getStructuredAiAvailability({ userId: context.userId, tenantId: context.tenantId });
    return { status: availability.available ? "available" : "unavailable", message: availability.message };
  } catch {
    return { status: "unavailable", message: UNREADABLE_AVAILABILITY_MESSAGE };
  }
}

function unavailable(message: string, status: MaterialRequestPhotoAnalysisAvailability["status"]) {
  return conflict(message, { status }, MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE);
}

/** The plan's access was lost: the same refusal as before the reading, with the sentence that says what to do. */
const ACCESS_CODES = new Set(["AI_AUTH_REQUIRED", "AI_NOT_CONFIGURED", "AI_LOCAL_DISABLED", "AI_OWNER_INACTIVE"]);

const FAILURE_MESSAGES: Record<string, string> = {
  AI_QUOTA: "La limite du forfait ChatGPT est atteinte : la photo n’a pas été lue. Consultez votre consommation dans Mon profil.",
  AI_RATE_LIMIT: "ChatGPT limite les demandes pour le moment : la photo n’a pas été lue. Réessayez dans quelques minutes.",
  AI_REQUEST_REJECTED:
    "ChatGPT a refusé cette photo, ou le modèle choisi ne lit pas les images. Vérifiez le modèle dans Mon profil, ou saisissez les lignes à la main.",
  TIMEOUT: "La lecture de la photo a dépassé son délai. Relancez-la, ou réduisez l’effort du modèle dans Mon profil.",
  INVALID_ANSWER: "L’IA a renvoyé une réponse inexploitable pour cette photo. Relancez la lecture, ou saisissez les lignes à la main.",
  PROVIDER_ERROR: "ChatGPT n’a pas terminé la lecture de cette photo. Relancez-la, ou saisissez les lignes à la main.",
};

/** Only this module's sentences and a closed reason cross: nothing the provider or the runtime said. */
function readingFailure(error: unknown): ApiError {
  if (error instanceof StructuredAiError && ACCESS_CODES.has(error.code)) return unavailable(error.message, "unavailable");
  const reason = error instanceof StructuredAiError
    ? (error.code in FAILURE_MESSAGES ? error.code : "PROVIDER_ERROR")
    : error instanceof Error && error.name === "TimeoutError"
      ? "TIMEOUT"
      : error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")
        ? "INVALID_ANSWER"
        : "PROVIDER_ERROR";
  return new ApiError({
    status: 503,
    code: MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED,
    message: FAILURE_MESSAGES[reason],
    details: { reason },
  });
}

export async function analyzeMaterialRequestPhoto(
  projectId: string,
  requestId: string,
  fileId: string,
): Promise<MaterialRequestPhotoAnalysis> {
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  const request = await requireRequest(access, requestId);

  const availability = await getMaterialRequestPhotoAnalysisAvailability(context);
  if (availability.status !== "available") throw unavailable(availability.message, availability.status);

  const { data: file, error } = await context.supabase
    .from("material_request_files")
    .select("id, quote_id, storage_path, mime_type, byte_size, rotation, stored_at, removed_at")
    .eq("id", fileId)
    .eq("tenant_id", context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", request.id)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger cet original.");
  // An original of the request that exists for a reader: never a quote's file (a supplier's document), a photo whose
  // upload did not finish, or one on its way out.
  if (!file || (file.quote_id ?? null) !== null || file.stored_at === null || (file.removed_at ?? null) !== null) {
    throw notFound(FILE_NOT_FOUND_MESSAGE);
  }
  const mimeType = MATERIAL_REQUEST_FILE_MIME_TYPES.find((type) => type === file.mime_type);
  if (!mimeType) throw notFound(FILE_NOT_FOUND_MESSAGE);
  if (file.byte_size > MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES) {
    throw payloadTooLarge(
      `Cette photo dépasse ${MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES / (1024 * 1024)} Mo : elle est trop lourde pour être lue par l’IA.`,
      undefined,
      MATERIAL_REQUEST_PHOTO_TOO_LARGE,
    );
  }

  const { data: bytes, error: downloadError } = await context.supabase.storage
    .from(MATERIAL_REQUESTS_BUCKET)
    .download(file.storage_path);
  if (downloadError || !bytes) {
    console.error("Material request original could not be read for its analysis", { fileId, error: downloadError });
    throw internalError("Impossible de récupérer cet original.");
  }
  const data = Buffer.from(await bytes.arrayBuffer()).toString("base64");

  try {
    // Without an owner: the AI module resolves the caller's own plan from their session, on a local host only.
    const answer = await callStructuredAi({
      prompt: buildMaterialRequestPhotoPrompt({ rotation: file.rotation as MaterialRequestFileRotation }),
      schema: materialRequestPhotoAnswerSchema,
      files: [{ mimeType, data, detail: "high" }],
      timeoutMs: MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS,
      context: { tenantId: context.tenantId, promptVersion: MATERIAL_REQUEST_PHOTO_ANALYSIS_PROMPT_VERSION },
    });
    return { file_id: file.id, lines: draftsFromPhotoAnswer(answer.data), model: answer.model };
  } catch (cause) {
    const failure = readingFailure(cause);
    console.error("Material request photo analysis failed", {
      requestId: request.id,
      fileId: file.id,
      code: failure.code,
      details: failure.details,
    });
    throw failure;
  }
}
