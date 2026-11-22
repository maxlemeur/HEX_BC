import { notFound, ok, toErrorResponse } from "@/lib/http/api-response";
import { itemTemplateKeySchema } from "@/lib/takeoff/item-list-contracts";
import { loadItemTemplateAdministration } from "@/lib/takeoff/item-template-server";

/** The published template and the administrator's draft with what publishing it would change (administrators only). */
export async function GET(_request: Request, { params }: { params: Promise<{ templateKey: string }> }) {
  try {
    const key = itemTemplateKeySchema.safeParse((await params).templateKey);
    if (!key.success) throw notFound("Gabarit introuvable.");
    return ok(await loadItemTemplateAdministration(key.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
