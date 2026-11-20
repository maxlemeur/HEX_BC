import { productActionSchema } from "@/lib/catalogue/directory-schemas";
import {
  createProduct,
  updateProduct,
} from "@/lib/catalogue/product-writes";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";

export async function POST(request: Request) {
  try {
    const payload = productActionSchema.parse(await parseJsonBody(request, badRequest));

    if (payload.action === "create") {
      return ok(await createProduct(payload.item), 201);
    }

    return ok(await updateProduct(payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}
