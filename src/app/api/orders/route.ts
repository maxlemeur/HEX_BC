import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { getOrdersDirectoryData } from "@/lib/purchase-orders/list";
import { ordersListQuerySchema } from "@/lib/purchase-orders/schemas";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = ordersListQuerySchema.parse({
      view: searchParams.get("view") ?? "list",
      order_id: searchParams.getAll("order_id"),
      q: searchParams.get("q") ?? undefined,
      page: searchParams.get("page") ?? undefined,
      size: searchParams.get("size") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
      direction: searchParams.get("direction") ?? undefined,
      status: searchParams.getAll("status"),
      supplier_id: searchParams.get("supplier_id") ?? undefined,
      delivery_site_id: searchParams.get("delivery_site_id") ?? undefined,
      has_devis: searchParams.get("has_devis") ?? undefined,
      date_from: searchParams.get("date_from") ?? undefined,
      date_to: searchParams.get("date_to") ?? undefined,
    });

    return ok(await getOrdersDirectoryData(query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
