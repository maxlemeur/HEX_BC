import { NextResponse } from "next/server";
import { coverageCitationVerificationSchema } from "@/lib/estimates/source-coverage-contracts";
import { coverageError, coverageFailure, readCoverageJson, SOURCE_COVERAGE_HEADERS } from "@/lib/estimates/source-coverage-http";
import { verifySourceCoverageCitation } from "@/lib/estimates/source-coverage-server";
import { createSourceReferenceDeadline } from "@/lib/estimates/source-reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string; requirementId: string }> }) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    const input = await readCoverageJson(request, coverageCitationVerificationSchema, budget);
    const { versionId, requirementId } = await budget.wait(params);
    if (input.requirementId !== requirementId.toLowerCase()) throw coverageError("SOURCE_COVERAGE_INVALID_INPUT");
    const data = await verifySourceCoverageCitation(versionId, input, budget);
    return NextResponse.json({ ok: true, data }, { status: data.replayed ? 200 : 201, headers: SOURCE_COVERAGE_HEADERS });
  } catch (error) { return coverageFailure(error); }
  finally { budget.dispose(); }
}
