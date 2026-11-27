import {
  badRequest,
  createCatalogueItem,
  deleteCatalogueItem,
  linkMappedRowsToCatalogue,
  listCatalogueItems,
  listCataloguePage,
  ok,
  toErrorResponse,
  updateCatalogueItem,
} from "@/lib/catalogue/server";
import {
  catalogueActionSchema,
  catalogueListQuerySchema,
  cataloguePageQuerySchema,
} from "@/lib/catalogue/schemas";
import { parseJsonBody, parsePositiveIntParam } from "@/lib/http/request";

function parseBoolean(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;

  throw badRequest("Paramètre booleen invalide.");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get("view") === "page") {
      const pageQuery = cataloguePageQuerySchema.parse({
        q: searchParams.get("q") ?? "",
        material: searchParams.getAll("material"),
        supply_type: searchParams.getAll("supply_type"),
        unit: searchParams.getAll("unit"),
        price_status: searchParams.getAll("price_status"),
        status: searchParams.getAll("status"),
        catalogue_status: searchParams.getAll("catalogue_status"),
        sort: searchParams.get("sort") ?? "designation",
        dir: searchParams.get("dir") ?? "asc",
        page: parsePositiveIntParam(searchParams.get("page"), badRequest) ?? 1,
        size: parsePositiveIntParam(searchParams.get("size"), badRequest) ?? 25,
      });

      return ok(await listCataloguePage(pageQuery));
    }

    const query = catalogueListQuerySchema.parse({
      id: searchParams.get("id"),
      search: searchParams.get("search"),
      limit: parsePositiveIntParam(searchParams.get("limit"), badRequest) ?? 100,
      include_inactive: parseBoolean(searchParams.get("include_inactive")) ?? false,
      validated_only: parseBoolean(searchParams.get("validated_only")) ?? false,
    });

    const data = await listCatalogueItems(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request, badRequest);
    const payload = catalogueActionSchema.parse(body);

    switch (payload.action) {
      case "create": {
        const data = await createCatalogueItem(payload.item);
        return ok(data, 201);
      }
      case "update": {
        const data = await updateCatalogueItem(payload);
        return ok(data);
      }
      case "delete": {
        const data = await deleteCatalogueItem(payload.id);
        return ok(data);
      }
      case "link-mapped-rows": {
        const data = await linkMappedRowsToCatalogue(payload);
        return ok(data);
      }
      default:
        throw badRequest("Action catalogue non supportee.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
