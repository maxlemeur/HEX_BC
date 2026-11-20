import { suggestProductReference } from "@/lib/catalogue/product-writes";
import { ok, toErrorResponse } from "@/lib/http/api-response";

export async function GET() {
  try {
    return ok(await suggestProductReference());
  } catch (error) {
    return toErrorResponse(error);
  }
}
