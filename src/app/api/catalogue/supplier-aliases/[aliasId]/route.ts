import { deleteSupplierAlias } from "@/lib/catalogue/import-review-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";
import { uuidRouteParam } from "@/lib/http/request";

type Context = { params: Promise<{ aliasId: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  try {
    return ok(await deleteSupplierAlias(await uuidRouteParam(params, "aliasId")));
  } catch (error) {
    return toErrorResponse(error);
  }
}
