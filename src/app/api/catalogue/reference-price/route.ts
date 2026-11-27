import { referencePriceActionSchema, referencePriceQuerySchema } from "@/lib/catalogue/reference-price-schemas";
import { actOnReferencePrice, getReferencePriceProposal } from "@/lib/catalogue/reference-price-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { searchParamsObject } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const query = referencePriceQuerySchema.parse(searchParamsObject(request));
    return ok(await getReferencePriceProposal(query));
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); } catch { throw badRequest("Payload JSON invalide."); }
    return ok(await actOnReferencePrice(referencePriceActionSchema.parse(body)));
  } catch (error) { return toErrorResponse(error); }
}
