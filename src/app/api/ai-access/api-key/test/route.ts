import { ApiKeyTestRequestSchema } from "@/lib/ai/access/contracts";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { apiKeyOk, apiKeyRouteError, readJsonBody, requireApiKeyOwner } from "@/lib/ai/access/route-boundary";
import { badRequest } from "@/lib/http/api-response";

/** « Tester le modèle »: one small billable call with the saved key, no customer document. */
export async function POST(request: Request) {
  try {
    const owner = await requireApiKeyOwner(request, { write: true, json: true });
    const parsed = ApiKeyTestRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw badRequest("Demande invalide.", undefined, "AI_KEY_BODY");
    return apiKeyOk(await openAiApiKeyAccess().test(owner, parsed.data.model));
  } catch (error) {
    return apiKeyRouteError(error);
  }
}
