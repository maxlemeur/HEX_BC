import { NextResponse } from "next/server";
import { z } from "zod";
import { coverageFailure, readCoverageQuery, SOURCE_COVERAGE_HEADERS } from "@/lib/estimates/source-coverage-http";
import { previewSourceCoverageDecision } from "@/lib/estimates/source-coverage-server";
import { createSourceReferenceDeadline } from "@/lib/estimates/source-reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string; requirementId: string }> }) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    readCoverageQuery(request, z.strictObject({}));
    const { versionId, requirementId } = await budget.wait(params);
    const data = await budget.wait(previewSourceCoverageDecision(versionId, requirementId, { signal: budget.signal }));
    return NextResponse.json({ ok: true, data }, { headers: SOURCE_COVERAGE_HEADERS });
  } catch (error) { return coverageFailure(error); }
  finally { budget.dispose(); }
}
