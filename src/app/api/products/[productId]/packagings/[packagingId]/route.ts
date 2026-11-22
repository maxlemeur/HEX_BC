import { productPackagingParamsSchema, updateProductPackagingSchema } from "@/lib/catalogue/packagings";
import { deleteProductPackaging, updateProductPackaging } from "@/lib/catalogue/packagings-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";

type Context = { params: Promise<{ productId: string; packagingId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { productId, packagingId } = productPackagingParamsSchema.parse(await params);
    const payload = updateProductPackagingSchema.parse(await parseJsonBody(request, badRequest));
    return ok(await updateProductPackaging(productId, packagingId, payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { productId, packagingId } = productPackagingParamsSchema.parse(await params);
    return ok(await deleteProductPackaging(productId, packagingId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
