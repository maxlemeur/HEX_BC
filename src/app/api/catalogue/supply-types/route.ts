import { createSupplyTypeSchema } from "@/lib/catalogue/supply-types";
import { createSupplyType, listSupplyTypes } from "@/lib/catalogue/supply-types-server";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";

export async function GET() {
  try {
    return ok(await listSupplyTypes());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest("Payload JSON invalide.");
    }
    return ok(await createSupplyType(createSupplyTypeSchema.parse(body)), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
