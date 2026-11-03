import { readBenchReportMarkdown } from "@/lib/takeoff/lab/bench-reports";
import { labErrorResponse, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";

/** report.md of one takeoff:bench run, as text. */
export async function GET(_request: Request, { params }: { params: Promise<{ report: string }> }) {
  try {
    await requireTakeoffLabAccess();
    return new Response(await readBenchReportMarkdown((await params).report), {
      headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return labErrorResponse(error);
  }
}
