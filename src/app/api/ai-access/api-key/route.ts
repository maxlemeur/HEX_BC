import { ApiKeySaveRequestSchema, aiAnalysisPreferencesUpdateSchema } from "@/lib/ai/access/contracts";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { apiKeyOk, apiKeyRouteError, readJsonBody, requireApiKeyOwner } from "@/lib/ai/access/route-boundary";
import { badRequest } from "@/lib/http/api-response";

/** « Mon profil › Clé API »: the masked state, read from MergeOne's own record (the Keychain is not opened). */
export async function GET(request: Request) {
  try {
    return apiKeyOk(await openAiApiKeyAccess().state(await requireApiKeyOwner(request, { write: false })));
  } catch (error) {
    return apiKeyRouteError(error);
  }
}

/** « Vérifier et enregistrer » and « Remplacer »: the candidate is checked with OpenAI before it replaces anything. */
export async function PUT(request: Request) {
  try {
    const owner = await requireApiKeyOwner(request, { write: true, json: true, keyInBody: true });
    const parsed = ApiKeySaveRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw badRequest("Demande invalide.", undefined, "AI_KEY_BODY");
    return apiKeyOk(await openAiApiKeyAccess().save(owner, { key: parsed.data.key, testModel: parsed.data.testModel ?? null }));
  } catch (error) {
    return apiKeyRouteError(error);
  }
}

/** Refresh the key’s catalog, or save the photo analysis settings without calling the provider. */
export async function PATCH(request: Request) {
  try {
    // Next can wrap a bodyless PATCH in an empty stream. Use the HTTP framing to distinguish it from JSON.
    const hasPayload = request.headers.has("content-type") || request.headers.has("transfer-encoding")
      || Number(request.headers.get("content-length")) > 0;
    const owner = await requireApiKeyOwner(request, { write: true, json: hasPayload });
    const access = openAiApiKeyAccess();
    if (!hasPayload) return apiKeyOk(await access.refreshModels(owner));
    const parsed = aiAnalysisPreferencesUpdateSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw badRequest("Réglages IA invalides.", undefined, "AI_KEY_BODY");
    const { connectionId, ...preferences } = parsed.data;
    return apiKeyOk(await access.saveAnalysisPreferences(owner, preferences, connectionId));
  } catch (error) {
    return apiKeyRouteError(error);
  }
}

/** « Retirer »: no new call uses the key; revoking it at OpenAI stays the member's step. */
export async function DELETE(request: Request) {
  try {
    return apiKeyOk(await openAiApiKeyAccess().remove(await requireApiKeyOwner(request, { write: true, json: false })));
  } catch (error) {
    return apiKeyRouteError(error);
  }
}
