import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { requestParamsSchema } from "@/lib/material-requests/http";
import { listLineSupplierProposals } from "@/lib/material-requests/suppliers-server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/** The proposed supplier of each line that has an article and no supplier yet (TI-691). */
export async function GET(_request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    return ok(await listLineSupplierProposals(projectId, requestId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
