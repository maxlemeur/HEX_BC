import { NextResponse } from "next/server";
import { sourceReferenceConfirmationInputSchema } from "@/lib/estimates/source-reference-contracts";
import { createSourceReferenceDeadline, readSourceReferenceJson, SOURCE_REFERENCE_HEADERS, sourceReferenceFailure } from "@/lib/estimates/source-reference-http";
import { confirmSourceReference } from "@/lib/estimates/source-reference-orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    const input = await readSourceReferenceJson(request, sourceReferenceConfirmationInputSchema, budget);
    const { versionId } = await budget.wait(params);
    const data = await confirmSourceReference(versionId, input, budget);
    budget.check();
    return NextResponse.json({ ok: true, data }, { status: data.replayed ? 200 : 201, headers: SOURCE_REFERENCE_HEADERS });
  } catch (error) { return sourceReferenceFailure(error); }
  finally { budget.dispose(); }
}
