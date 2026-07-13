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

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw badRequest("Parametre limit invalide.");
  }

  return parsed;
}

function parseBoolean(value: string | null): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();

  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;

  throw badRequest("Parametre booleen invalide.");
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

    if (searchParams.get("view") === "page") {
      const pageQuery = cataloguePageQuerySchema.parse({
        q: searchParams.get("q") ?? "",
        material: searchParams.getAll("material"),
        category: searchParams.getAll("category"),
        unit: searchParams.getAll("unit"),
        price_status: searchParams.getAll("price_status"),
        status: searchParams.getAll("status"),
        sort: searchParams.get("sort") ?? "designation",
        dir: searchParams.get("dir") ?? "asc",
        page: parsePositiveInt(searchParams.get("page")) ?? 1,
        size: parsePositiveInt(searchParams.get("size")) ?? 25,
      });

      return ok(await listCataloguePage(pageQuery));
    }

    const query = catalogueListQuerySchema.parse({
      search: searchParams.get("search"),
      limit: parsePositiveInt(searchParams.get("limit")) ?? 100,
      include_inactive: parseBoolean(searchParams.get("include_inactive")) ?? false,
    });

    const data = await listCatalogueItems(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonBody(request);
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
