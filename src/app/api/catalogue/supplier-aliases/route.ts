import { createSupplierAliasSchema } from "@/lib/catalogue/import-review-contract";
import { createSupplierAlias, listSupplierAliases } from "@/lib/catalogue/import-review-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";

export async function GET() {
  try {
    return ok(await listSupplierAliases());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return ok(await createSupplierAlias(createSupplierAliasSchema.parse(await parseJsonBody(request, badRequest))), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
