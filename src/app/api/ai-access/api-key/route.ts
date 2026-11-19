import { ApiKeySaveRequestSchema } from "@/lib/ai/access/contracts";
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

/** « Retirer »: no new call uses the key; revoking it at OpenAI stays the member's step. */
export async function DELETE(request: Request) {
  try {
    return apiKeyOk(await openAiApiKeyAccess().remove(await requireApiKeyOwner(request, { write: true, json: false })));
  } catch (error) {
    return apiKeyRouteError(error);
  }
}
