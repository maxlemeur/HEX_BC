import { NextResponse } from "next/server";

import { isAuthorizedCronRequest } from "@/lib/http/shared-secret";
import { recoverDurableWorkflows } from "@/lib/workflows/durable-recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await recoverDurableWorkflows());
  } catch (error) {
    console.error("Durable workflow recovery failed", { error });
    return NextResponse.json(
      { error: "Durable workflow recovery failed" },
      { status: 500 }
    );
  }
}
