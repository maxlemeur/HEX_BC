import { analysisProgressCursorSchema } from "@/lib/affaires/analysis-progress-contract";
import { readAffaireAnalysisProgress } from "@/lib/affaires/analysis-progress-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";
import { withPrivateNoStore } from "@/lib/http/response";

export async function GET(request: Request) {
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    const data = await readAffaireAnalysisProgress(cursor === null ? undefined : analysisProgressCursorSchema.parse(cursor));
    const response = ok(data);
    return withPrivateNoStore(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
