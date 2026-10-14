import { assertSourceReferenceQueryEmpty, createSourceReferenceDeadline, SOURCE_REFERENCE_HEADERS, sourceReferenceFailure, sourceReferencePdfDisposition } from "@/lib/estimates/source-reference-http";
import { readSourceReferenceContent } from "@/lib/estimates/source-reference-orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string; copyId: string }> }) {
  const budget = createSourceReferenceDeadline(request, 30_000);
  try {
    assertSourceReferenceQueryEmpty(request);
    const { versionId, copyId } = await budget.wait(params);
    const { bytes, copy } = await readSourceReferenceContent(versionId, copyId, budget);
    budget.check();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...SOURCE_REFERENCE_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": sourceReferencePdfDisposition(copy.fileName),
        "X-Source-Reference-Sha256": copy.sha256,
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "none",
      },
    });
  } catch (error) { return sourceReferenceFailure(error); }
  finally { budget.dispose(); }
}
