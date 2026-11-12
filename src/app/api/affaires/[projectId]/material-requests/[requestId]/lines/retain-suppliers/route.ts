import { ok, toErrorResponse } from "@/lib/estimates/errors";
import { readJsonBody, requestParamsSchema } from "@/lib/material-requests/http";
import { retainLineSuppliersSchema } from "@/lib/material-requests/supplier-contracts";
import { retainLineSuppliers } from "@/lib/material-requests/suppliers-server";

type Context = { params: Promise<{ projectId: string; requestId: string }> };

/** Retains a supplier for several lines, writing only those that still have none (TI-691). */
export async function POST(request: Request, { params }: Context) {
  try {
    const { projectId, requestId } = requestParamsSchema.parse(await params);
    const input = retainLineSuppliersSchema.parse(await readJsonBody(request));
    return ok(await retainLineSuppliers(projectId, requestId, input));
  } catch (error) {
    return toErrorResponse(error);
  }
}
