import {
  badRequest,
  bulkCreateSupplierPricesAtomic,
  bulkCreateSupplierPrices,
  createSupplierPrice,
  deleteSupplierPrice,
  getSupplierCatalogItem,
  listSupplierPrices,
  listSupplierPricesPage,
  ok,
  toErrorResponse,
  updateSupplierPrice,
  updateSupplierOffer,
  updateSupplierCatalogItem,
} from "@/lib/catalogue/server";
import {
  pricesActionSchema,
  pricesListQuerySchema,
  pricesPageQuerySchema,
  supplierCatalogItemLookupQuerySchema,
} from "@/lib/catalogue/schemas";
import { parseJsonBody, parsePositiveIntParam } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productIdParam =
      searchParams.get("product_id") ?? searchParams.get("catalogue_item_id");

    if (searchParams.get("view") === "supplier-item") {
      const lookupQuery = supplierCatalogItemLookupQuerySchema.parse({
        supplier_id: searchParams.get("supplier_id"),
        product_id: productIdParam,
      });

      return ok(await getSupplierCatalogItem(lookupQuery));
    }

    if (searchParams.get("view") === "page") {
      const pageQuery = pricesPageQuerySchema.parse({
        q: searchParams.get("q") ?? "",
        freshness: searchParams.getAll("freshness"),
        supplier_id: searchParams.get("supplier_id"),
        product_id: productIdParam,
        sort: searchParams.get("sort") ?? "updated_at",
        dir: searchParams.get("dir") ?? "desc",
        page: parsePositiveIntParam(searchParams.get("page"), badRequest) ?? 1,
        size: parsePositiveIntParam(searchParams.get("size"), badRequest) ?? 25,
      });

      return ok(await listSupplierPricesPage(pageQuery));
    }

    const query = pricesListQuerySchema.parse({
      supplier_id: searchParams.get("supplier_id"),
      product_id: productIdParam,
      catalogue_item_id: searchParams.get("catalogue_item_id"),
      limit: parsePositiveIntParam(searchParams.get("limit"), badRequest) ?? 200,
    });

    const data = await listSupplierPrices(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, badRequest);
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
      case "update-offer": {
        return ok(await updateSupplierOffer(payload));
      }
      case "delete": {
        const data = await deleteSupplierPrice(payload.id);
        return ok(data);
      }
      case "update-supplier-item": {
        const data = await updateSupplierCatalogItem(payload);
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
