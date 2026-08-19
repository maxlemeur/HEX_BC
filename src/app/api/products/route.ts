import { productActionSchema } from "@/lib/catalogue/directory-schemas";
import {
  createProduct,
  updateProduct,
} from "@/lib/catalogue/product-writes";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function POST(request: Request) {
  try {
    const payload = productActionSchema.parse(await parseJsonBody(request));

    if (payload.action === "create") {
      return ok(await createProduct(payload.item), 201);
    }

    return ok(await updateProduct(payload));
  } catch (error) {
    return toErrorResponse(error);
  }
}
