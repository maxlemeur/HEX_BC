import { analysisProgressSinceSchema } from "@/lib/affaires/analysis-progress-contract";
import { readAffaireAnalysisProgress } from "@/lib/affaires/analysis-progress-server";
import { ok, toErrorResponse } from "@/lib/http/api-response";

export async function GET(request: Request) {
  try {
    const since = new URL(request.url).searchParams.get("since");
    const data = await readAffaireAnalysisProgress(since === null ? undefined : analysisProgressSinceSchema.parse(since));
    const response = ok(data);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
