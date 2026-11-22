import { badRequest, notFound, ok, toErrorResponse, unprocessableEntity } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";
import {
  itemTemplateDiscardRequestSchema,
  itemTemplateKeySchema,
  itemTemplateSaveRequestSchema,
} from "@/lib/takeoff/item-list-contracts";
import { discardItemTemplateDraft, saveItemTemplateDraft } from "@/lib/takeoff/item-template-server";

type Params = { params: Promise<{ templateKey: string }> };

async function templateKey(params: Params["params"]) {
  const key = itemTemplateKeySchema.safeParse((await params).templateKey);
  if (!key.success) throw notFound("Gabarit introuvable.");
  return key.data;
}

/** Save the administrator's draft, on the revision and the published version their form started from. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const key = await templateKey(params);
    const body = itemTemplateSaveRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) {
      throw unprocessableEntity(body.error.issues[0]?.message ?? "Le gabarit n’est pas valide.",
        { issues: body.error.issues.slice(0, 20).map(({ path, message }) => ({ path, message })) }, "TAKEOFF_ITEM_TEMPLATE_INVALID");
    }
    return ok(await saveItemTemplateDraft(key, { expectedToken: body.data.expected_token,
      baseVersion: body.data.base_version, definition: body.data.definition }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Drop the draft, back to the published version. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const key = await templateKey(params);
    const body = itemTemplateDiscardRequestSchema.safeParse(await parseJsonBody(request, badRequest));
    if (!body.success) throw unprocessableEntity("Demande invalide : rechargez la page.", undefined, "VALIDATION_ERROR");
    return ok(await discardItemTemplateDraft(key, { expectedToken: body.data.expected_token }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
