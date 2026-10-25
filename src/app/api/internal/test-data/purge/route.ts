import { NextResponse } from "next/server";

import { sharedSecretMatches } from "@/lib/http/shared-secret";
import { purgeTestTenantDrafts } from "@/lib/test-data/purge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret &&
      sharedSecretMatches(request.headers.get("authorization"), `Bearer ${secret}`)
  );
}

// Weekly caller: .github/workflows/purge-test-data.yml. `?dryRun=1` lists without deleting.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    return NextResponse.json(await purgeTestTenantDrafts({ dryRun }));
  } catch (error) {
    console.error("Test data purge failed", { error });
    return NextResponse.json({ error: "Test data purge failed" }, { status: 500 });
  }
}
