import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import { itemTemplateKeySchema, itemTemplatePublishRequestSchema } from "@/lib/takeoff/item-list-contracts";
import { publishItemTemplate } from "@/lib/takeoff/item-template-server";

/** Publish the draft the administrator saw: a new version for the tenant's next lists, nothing changed in others. */
export async function POST(request: Request, { params }: { params: Promise<{ templateKey: string }> }) {
  try {
    const key = itemTemplateKeySchema.safeParse((await params).templateKey);
    if (!key.success) throw notFound("Gabarit introuvable.");
    const body = itemTemplatePublishRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Demande invalide : rechargez la page.", undefined, "VALIDATION_ERROR");
    return ok(await publishItemTemplate(key.data, { expectedToken: body.data.expected_token,
      intentKey: body.data.intent_key }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
