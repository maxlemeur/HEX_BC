import { NextResponse } from "next/server";
import { coverageQuerySchema, coverageRequirementMutationSchema } from "@/lib/estimates/source-coverage-contracts";
import { coverageFailure, readCoverageJson, readCoverageQuery, SOURCE_COVERAGE_HEADERS } from "@/lib/estimates/source-coverage-http";
import { mutateSourceCoverageRequirement, readSourceCoverage } from "@/lib/estimates/source-coverage-server";
import { createSourceReferenceDeadline } from "@/lib/estimates/source-reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;
type Context = { params: Promise<{ versionId: string }> };

export async function GET(request: Request, { params }: Context) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    const query = readCoverageQuery(request, coverageQuerySchema, ["limit", "beforeEvent"]);
    const { versionId } = await budget.wait(params);
    const data = await budget.wait(readSourceCoverage(versionId, query, { signal: budget.signal }));
    return NextResponse.json({ ok: true, data }, { headers: SOURCE_COVERAGE_HEADERS });
  } catch (error) { return coverageFailure(error); }
  finally { budget.dispose(); }
}

export async function POST(request: Request, { params }: Context) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    const input = await readCoverageJson(request, coverageRequirementMutationSchema, budget);
    const { versionId } = await budget.wait(params);
    const data = await mutateSourceCoverageRequirement(versionId, input, budget);
    return NextResponse.json({ ok: true, data }, { status: data.replayed ? 200 : 201, headers: SOURCE_COVERAGE_HEADERS });
  } catch (error) { return coverageFailure(error); }
  finally { budget.dispose(); }
}
