import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { listProductAliases } from "@/lib/material-requests/articles-server";
import { productParamsSchema } from "@/lib/material-requests/http";

type Context = { params: Promise<{ productId: string }> };

/** The usual names the office taught an article (TI-690). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { productId } = productParamsSchema.parse(await params);
    return ok(await listProductAliases(productId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
