import {
  COSTING_WORKBOOK_MAX_BODY_BYTES,
  costingWorkbookImportSchema,
} from "@/lib/catalogue/costing-workbook-contract";
import { importCostingWorkbook } from "@/lib/catalogue/costing-workbook-server";
import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { readJsonBody } from "@/lib/material-requests/http";

// About 2,600 drafts: the catalogue read and a dozen chunked writes take seconds, more than a default budget.
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, {
      maxBytes: COSTING_WORKBOOK_MAX_BODY_BYTES,
      tooLargeMessage: "Cet onglet est trop volumineux pour être importé en une fois (4 Mo au plus).",
    });
    return ok(await importCostingWorkbook(costingWorkbookImportSchema.parse(body)));
  } catch (error) {
    return toErrorResponse(error);
  }
}
