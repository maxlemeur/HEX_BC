import {
  badRequest,
  bulkCreateSupplierPrices,
  createSupplierPrice,
  deleteSupplierPrice,
  listSupplierPrices,
  ok,
  toErrorResponse,
  updateSupplierPrice,
} from "@/lib/catalogue/server";
import { pricesActionSchema, pricesListQuerySchema } from "@/lib/catalogue/schemas";

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest("Parametre limit invalide.");
  }

  return parsed;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productIdParam =
      searchParams.get("product_id") ?? searchParams.get("catalogue_item_id");

    const query = pricesListQuerySchema.parse({
      supplier_id: searchParams.get("supplier_id"),
      product_id: productIdParam,
      catalogue_item_id: searchParams.get("catalogue_item_id"),
      limit: parsePositiveInt(searchParams.get("limit")) ?? 200,
    });

    const data = await listSupplierPrices(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
    const payload = pricesActionSchema.parse(body);

    switch (payload.action) {
      case "create": {
        const data = await createSupplierPrice(payload.item);
        return ok(data, 201);
      }
      case "update": {
        const data = await updateSupplierPrice(payload);
        return ok(data);
      }
      case "delete": {
        const data = await deleteSupplierPrice(payload.id);
        return ok(data);
      }
      case "bulk-create": {
        const data = await bulkCreateSupplierPrices(payload.items);
        return ok(data);
      }
      default:
        throw badRequest("Action prix non supportee.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
