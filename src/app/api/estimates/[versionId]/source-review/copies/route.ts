import { NextResponse } from "next/server";
import { sourceReferencePreparationInputSchema } from "@/lib/estimates/source-reference-contracts";
import { createSourceReferenceDeadline, readSourceReferenceJson, SOURCE_REFERENCE_HEADERS, sourceReferenceFailure } from "@/lib/estimates/source-reference-http";
import { prepareSourceReference } from "@/lib/estimates/source-reference-orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 65;

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const budget = createSourceReferenceDeadline(request, 60_000);
  try {
    const input = await readSourceReferenceJson(request, sourceReferencePreparationInputSchema, budget);
    const { versionId } = await budget.wait(params);
    const data = await prepareSourceReference(versionId, input, budget);
    budget.check();
    return NextResponse.json({ ok: true, data }, { status: data.replayed ? 200 : 201, headers: SOURCE_REFERENCE_HEADERS });
  } catch (error) { return sourceReferenceFailure(error); }
  finally { budget.dispose(); }
}
