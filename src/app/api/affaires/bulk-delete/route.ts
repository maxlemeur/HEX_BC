import {
  bulkDeleteAffairesInputSchema,
  bulkDeleteDraftAffaires,
} from "@/lib/affaires/delete-server";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => {
      throw badRequest("Payload JSON invalide.");
    });
    const { projectIds } = bulkDeleteAffairesInputSchema.parse(payload);
    const result = await bulkDeleteDraftAffaires(projectIds);
    return ok(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
