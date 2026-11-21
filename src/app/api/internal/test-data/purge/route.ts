import { apiFailure } from "@/lib/http/api-response";
import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/http/shared-secret";
import { purgeTestTenantDrafts } from "@/lib/test-data/purge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly caller: .github/workflows/purge-test-data.yml. `?dryRun=1` lists without deleting.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return apiFailure(401, "UNAUTHORIZED", "Unauthorized");
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    return NextResponse.json(await purgeTestTenantDrafts({ dryRun }));
  } catch (error) {
    console.error("Test data purge failed", { error });
    return apiFailure(500, "INTERNAL_ERROR", "Test data purge failed");
  }
}
