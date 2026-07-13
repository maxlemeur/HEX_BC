import {
  badRequest,
  bulkCreateSupplierPricesAtomic,
  bulkCreateSupplierPrices,
  createSupplierPrice,
  deleteSupplierPrice,
  listSupplierPrices,
  listSupplierPricesPage,
  ok,
  toErrorResponse,
  updateSupplierPrice,
} from "@/lib/catalogue/server";
import {
  pricesActionSchema,
  pricesListQuerySchema,
  pricesPageQuerySchema,
} from "@/lib/catalogue/schemas";

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

    if (searchParams.get("view") === "page") {
      const pageQuery = pricesPageQuerySchema.parse({
        q: searchParams.get("q") ?? "",
        freshness: searchParams.getAll("freshness"),
        supplier_id: searchParams.get("supplier_id"),
        product_id: productIdParam,
        sort: searchParams.get("sort") ?? "updated_at",
        dir: searchParams.get("dir") ?? "desc",
        page: parsePositiveInt(searchParams.get("page")) ?? 1,
        size: parsePositiveInt(searchParams.get("size")) ?? 25,
      });

      return ok(await listSupplierPricesPage(pageQuery));
    }

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
      case "bulk-create-atomic": {
        const data = await bulkCreateSupplierPricesAtomic(payload);
        return ok(data);
      }
      default:
        throw badRequest("Action prix non supportee.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
