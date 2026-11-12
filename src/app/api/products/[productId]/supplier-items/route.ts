import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { productParamsSchema, readJsonBody } from "@/lib/material-requests/http";
import { saveArticleSupplierItemSchema } from "@/lib/material-requests/supplier-contracts";
import { listArticleSupplierItems, saveArticleSupplierItem } from "@/lib/material-requests/suppliers-server";

type Context = { params: Promise<{ productId: string }> };

/** The suppliers of an article and its reference at each, without prices (TI-691). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { productId } = productParamsSchema.parse(await params);
    return ok(await listArticleSupplierItems(productId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Adds or changes the article's reference at a supplier; `is_active: false` withdraws that supplier. */
export async function PUT(request: Request, { params }: Context) {
  try {
    const { productId } = productParamsSchema.parse(await params);
    const input = saveArticleSupplierItemSchema.parse(await readJsonBody(request));
    return ok(await saveArticleSupplierItem(productId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
