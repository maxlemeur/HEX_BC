import { suggestProductReference } from "@/lib/catalogue/product-writes";
import { ok, toErrorResponse } from "@/lib/estimates/errors";

export async function GET() {
  try {
    return ok(await suggestProductReference());
  } catch (error) {
    return toErrorResponse(error);
  }
}
