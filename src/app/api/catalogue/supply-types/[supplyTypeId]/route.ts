import { setSupplyTypePreferredSupplier } from "@/lib/catalogue/supply-types-server";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { readJsonBody, supplyTypeParamsSchema } from "@/lib/material-requests/http";
import { supplyTypePreferredSupplierSchema } from "@/lib/material-requests/supplier-contracts";

type Context = { params: Promise<{ supplyTypeId: string }> };

/** The preferred supplier of a supply type (TI-691); null removes it. */
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { supplyTypeId } = supplyTypeParamsSchema.parse(await params);
    const { preferred_supplier_id: preferredSupplierId } = supplyTypePreferredSupplierSchema.parse(await readJsonBody(request));
    return ok(await setSupplyTypePreferredSupplier(supplyTypeId, preferredSupplierId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
