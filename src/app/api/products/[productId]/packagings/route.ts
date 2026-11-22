import { createProductPackagingSchema } from "@/lib/catalogue/packagings";
import { createProductPackaging, listProductPackagings } from "@/lib/catalogue/packagings-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody, productParamsSchema } from "@/lib/http/request";

type Context = { params: Promise<{ productId: string }> };

/** The sale packagings of an article, and whether the caller may change them. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { productId } = productParamsSchema.parse(await params);
    return ok(await listProductPackagings(productId));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { productId } = productParamsSchema.parse(await params);
    const payload = createProductPackagingSchema.parse(await parseJsonBody(request, badRequest));
    return ok(await createProductPackaging(productId, payload), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
