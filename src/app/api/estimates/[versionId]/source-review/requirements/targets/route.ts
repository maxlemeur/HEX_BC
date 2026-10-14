import { NextResponse } from "next/server";
import { coverageTargetsQuerySchema } from "@/lib/estimates/source-coverage-contracts";
import { coverageFailure, readCoverageQuery, SOURCE_COVERAGE_HEADERS } from "@/lib/estimates/source-coverage-http";
import { readSourceCoverageTargets } from "@/lib/estimates/source-coverage-server";
import { createSourceReferenceDeadline } from "@/lib/estimates/source-reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    const query = readCoverageQuery(request, coverageTargetsQuerySchema, ["limit"]);
    const { versionId } = await budget.wait(params);
    const data = await budget.wait(readSourceCoverageTargets(versionId, query, { signal: budget.signal }));
    return NextResponse.json({ ok: true, data }, { headers: SOURCE_COVERAGE_HEADERS });
  } catch (error) { return coverageFailure(error); }
  finally { budget.dispose(); }
}
