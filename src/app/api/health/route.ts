import { NextResponse } from "next/server";

import packageMetadata from "../../../../package.json";
import { pingDatabase } from "@/lib/health-probe";

export const dynamic = "force-dynamic";

export type HealthPayload = {
  ok: boolean;
  version: string;
  db: "up" | "down";
};

export async function GET() {
  const db = await pingDatabase();
  const body: HealthPayload = {
    ok: db === "up",
    version: packageMetadata.version,
    db,
  };
  return NextResponse.json(body, {
    status: db === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
