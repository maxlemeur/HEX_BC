import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { reviewSuggestionLearningSchema } from "@/lib/estimates/schemas";
import { getLearnings, reviewLearning } from "@/lib/estimates/suggestion-learning";
import { parseJsonBody } from "@/lib/http/request";

export async function GET() {
  try {
    const data = await getLearnings({
      includeInactive: true,
      adminOnly: true,
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = reviewSuggestionLearningSchema.parse(await parseJsonBody(request, badRequest));

    const data = await reviewLearning({
      ruleId: body.rule_id,
      fieldName: body.field_name,
      correctedValue: body.corrected_value ?? null,
      action: body.action,
    });

    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
