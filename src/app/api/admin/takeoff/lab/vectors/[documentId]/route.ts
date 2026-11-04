import { badRequest, ok } from "@/lib/estimates/errors";
import { readLabDocument } from "@/lib/takeoff/lab/dataset";
import { readLabRun } from "@/lib/takeoff/lab/runs";
import { labErrorResponse, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";
import { requireLabPaths } from "@/lib/takeoff/lab/storage";
import { readLabVectorPage } from "@/lib/takeoff/lab/vectors";

/**
 * The vector reading of one page of a lab document (TI-662): `?page=n` (default 1), with `&run=<runId>` the
 * answers of that « classe de calque » essai of the same document page applied. Launching the task is POST /runs.
 */
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    await requireTakeoffLabAccess();
    const search = new URL(request.url).searchParams;
    const pageText = search.get("page") ?? "1";
    if (!/^[1-9]\d{0,4}$/.test(pageText)) throw badRequest("Page invalide.");
    const runId = search.get("run");
    const document = await readLabDocument((await params).documentId);
    const run = runId === null ? null : await readLabRun(await requireLabPaths(), runId);
    return ok(await readLabVectorPage({ document, page: Number(pageText), run }));
  } catch (error) {
    return labErrorResponse(error);
  }
}
