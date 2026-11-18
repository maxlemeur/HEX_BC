import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { apiKeyOk, apiKeyRouteError, requireApiKeyOwner } from "@/lib/ai/access/route-boundary";

/** The models MergeOne qualifies and the saved key lists (no generation, nothing billed). */
export async function GET(request: Request) {
  try {
    return apiKeyOk(await openAiApiKeyAccess().models(await requireApiKeyOwner(request, { write: false })));
  } catch (error) {
    return apiKeyRouteError(error);
  }
}
