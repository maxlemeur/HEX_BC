import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { getOrdersDirectoryData } from "@/lib/purchase-orders/list";
import { ordersListQuerySchema } from "@/lib/purchase-orders/schemas";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = ordersListQuerySchema.parse({
      view: searchParams.get("view") ?? "list",
      order_id: searchParams.getAll("order_id"),
    });

    return ok(await getOrdersDirectoryData(query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
