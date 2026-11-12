import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { deleteProductAlias } from "@/lib/material-requests/articles-server";
import { productAliasParamsSchema } from "@/lib/material-requests/http";

type Context = { params: Promise<{ productId: string; aliasId: string }> };

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { productId, aliasId } = productAliasParamsSchema.parse(await params);
    return ok(await deleteProductAlias(productId, aliasId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
