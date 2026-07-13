import { listPriceLookups, ok, toErrorResponse } from "@/lib/catalogue/server";
import { priceLookupsQuerySchema } from "@/lib/catalogue/schemas";

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = priceLookupsQuerySchema.parse({
      kind: searchParams.get("kind") ?? "all",
      q: searchParams.get("q") ?? "",
      selected_id: searchParams.get("selected_id"),
      limit: parsePositiveInt(searchParams.get("limit")) ?? 50,
    });

    return ok(await listPriceLookups(query));
  } catch (error) {
    return toErrorResponse(error);
  }
}
