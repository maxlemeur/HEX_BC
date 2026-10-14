import { NextResponse } from "next/server";

import { ApiError } from "@/lib/estimates/errors";
import { sourceReferenceReadErrorCodeSchema } from "@/lib/estimates/source-reference-contracts";
import {
  invalidSourceReferenceInput,
  readSourceReferenceReview,
} from "@/lib/estimates/source-reference-review";

const RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const query: Record<string, string | number> = {};
    for (const [name, value] of new URL(request.url).searchParams) {
      if (!["copyId", "cursor", "limit", "confirmationKey"].includes(name) || Object.hasOwn(query, name)) throw invalidSourceReferenceInput();
      if (name === "cursor" || name === "limit") {
        if (!/^[0-9]{1,16}$/.test(value)) throw invalidSourceReferenceInput();
        query[name] = Number(value);
      } else {
        query[name] = value;
      }
    }
    const data = await readSourceReferenceReview({ ...query, versionId: (await params).versionId });
    return NextResponse.json({ ok: true, data }, { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    const known = error instanceof ApiError && sourceReferenceReadErrorCodeSchema.safeParse(error.code).success;
    if (!known) console.error("Unexpected source reference review read failure.");
    return NextResponse.json({
      ok: false,
      error: known
        ? { code: error.code, message: error.message }
        : { code: "INTERNAL_ERROR", message: "Impossible de lire la revue documentaire." },
    }, { status: known ? error.status : 500, headers: RESPONSE_HEADERS });
  }
}
