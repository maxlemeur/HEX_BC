import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { purgeSuggestionLearningSchema } from "@/lib/estimates/schemas";
import { purgeLearnings } from "@/lib/estimates/suggestion-learning";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const body = purgeSuggestionLearningSchema.parse(await parseJsonBody(request));

    const data = await purgeLearnings({
      retentionMonths: body.retention_months,
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
