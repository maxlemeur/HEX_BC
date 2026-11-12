import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { productParamsSchema, readJsonBody } from "@/lib/material-requests/http";
import { productPreferredSupplierSchema } from "@/lib/material-requests/supplier-contracts";
import { setProductPreferredSupplier } from "@/lib/material-requests/suppliers-server";

type Context = { params: Promise<{ productId: string }> };

/** The article's supplier exception, proposed before its supply type's preferred supplier (TI-691). */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { productId } = productParamsSchema.parse(await params);
    const { preferred_supplier_id: preferredSupplierId } = productPreferredSupplierSchema.parse(await readJsonBody(request));
    return ok(await setProductPreferredSupplier(productId, preferredSupplierId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
