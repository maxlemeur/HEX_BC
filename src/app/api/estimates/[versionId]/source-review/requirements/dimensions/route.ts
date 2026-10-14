import { NextResponse } from "next/server";
import { coverageDimensionMutationSchema } from "@/lib/estimates/source-coverage-contracts";
import { coverageFailure, readCoverageJson, SOURCE_COVERAGE_HEADERS } from "@/lib/estimates/source-coverage-http";
import { mutateSourceCoverageDimension } from "@/lib/estimates/source-coverage-server";
import { createSourceReferenceDeadline } from "@/lib/estimates/source-reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    const input = await readCoverageJson(request, coverageDimensionMutationSchema, budget);
    const { versionId } = await budget.wait(params);
    const data = await mutateSourceCoverageDimension(versionId, input, budget);
    return NextResponse.json({ ok: true, data }, { status: data.replayed ? 200 : 201, headers: SOURCE_COVERAGE_HEADERS });
  } catch (error) { return coverageFailure(error); }
  finally { budget.dispose(); }
}
