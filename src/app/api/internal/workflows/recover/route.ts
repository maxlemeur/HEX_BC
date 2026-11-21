import { apiFailure } from "@/lib/http/api-response";
import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/http/shared-secret";
import { recoverDurableWorkflows } from "@/lib/workflows/durable-recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return apiFailure(401, "UNAUTHORIZED", "Unauthorized");
  }

  try {
    return NextResponse.json(await recoverDurableWorkflows());
  } catch (error) {
    console.error("Durable workflow recovery failed", { error });
    return apiFailure(500, "INTERNAL_ERROR", "Durable workflow recovery failed");
  }
}
