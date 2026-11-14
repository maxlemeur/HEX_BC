import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { projectParamsSchema } from "@/lib/material-requests/http";
import { getAffaireSupplyCost } from "@/lib/material-requests/supply-cost-server";

type Context = { params: Promise<{ projectId: string }> };

/** The supply cost of an affaire: budget of the accepted version face to its orders, per supply type (TI-691). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId } = projectParamsSchema.parse(await params);
    return ok(await getAffaireSupplyCost(projectId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
