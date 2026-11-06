import { ok, reviewTabularPdfImport, toErrorResponse } from "@/lib/imports/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readImportJson } from "@/lib/imports/request-body";

export async function POST(request: Request) {
  try {
    // Public calculation. A signed-in browser still gets the refresh previously handled by proxy.
    if (request.headers.has("cookie")) {
      const supabase = await createSupabaseServerClient("route");
      await supabase.auth.getClaims();
    }
    // Preserve the former proxy's 10 MiB ceiling, now with an explicit 413 for chunked requests.
    const body = await readImportJson(request, 10 * 1024 * 1024);
    const data = reviewTabularPdfImport(body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
