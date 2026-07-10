import {
  importProductPriceTemplate,
  productPriceTemplateImportSchema,
} from "@/lib/catalogue/product-price-template-server";
import { ok, toErrorResponse } from "@/lib/catalogue/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = productPriceTemplateImportSchema.parse(body);
    const data = await importProductPriceTemplate(input);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
