import {
  supplierActionSchema,
  supplierListQuerySchema,
} from "@/lib/catalogue/directory-schemas";
import {
  createSupplier,
  deleteSupplier,
  getSupplierUsage,
  listSuppliers,
  updateSupplier,
} from "@/lib/catalogue/suppliers";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";

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
    const query = supplierListQuerySchema.parse({
      view: searchParams.get("view") ?? "list",
      id: searchParams.get("id") ?? undefined,
    });

    if (query.view === "usage") {
      if (!query.id) {
        throw badRequest("Identifiant fournisseur requis.");
      }
      return ok(await getSupplierUsage(query.id));
    }

    return ok(await listSuppliers());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = supplierActionSchema.parse(await parseJsonBody(request));

    switch (payload.action) {
      case "create":
        return ok(await createSupplier(payload.item), 201);
      case "update":
        return ok(await updateSupplier(payload));
      case "delete":
        return ok(await deleteSupplier(payload.id));
      default:
        throw badRequest("Action fournisseur non supportee.");
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
