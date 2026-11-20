import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { purgeSuggestionLearningSchema } from "@/lib/estimates/schemas";
import { purgeLearnings } from "@/lib/estimates/suggestion-learning";
import { parseJsonBody } from "@/lib/http/request";

export async function POST(request: Request) {
  try {
    const body = purgeSuggestionLearningSchema.parse(await parseJsonBody(request, badRequest));

    const data = await purgeLearnings({
      retentionMonths: body.retention_months,
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
