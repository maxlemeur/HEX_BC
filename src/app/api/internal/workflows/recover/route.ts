import { NextResponse } from "next/server";

import { recoverDurableWorkflows } from "@/lib/workflows/durable-recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`
  );
}

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
