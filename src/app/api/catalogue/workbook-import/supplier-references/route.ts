import {
  COSTING_WORKBOOK_MAX_BODY_BYTES,
  costingWorkbookSupplierReferencesSchema,
} from "@/lib/catalogue/costing-workbook-contract";
import { importCostingWorkbookSupplierReferences } from "@/lib/catalogue/costing-workbook-supplier-references-server";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { readJsonBody } from "@/lib/material-requests/http";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, {
      maxBytes: COSTING_WORKBOOK_MAX_BODY_BYTES,
      tooLargeMessage: "Cet onglet est trop volumineux pour être importé en une fois (4 Mo au plus).",
    });
    return ok(await importCostingWorkbookSupplierReferences(costingWorkbookSupplierReferencesSchema.parse(body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
