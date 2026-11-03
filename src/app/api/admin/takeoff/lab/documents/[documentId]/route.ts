import { badRequest } from "@/lib/estimates/errors";
import { readLabDocument } from "@/lib/takeoff/lab/dataset";
import { labErrorResponse, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";

/**
 * The document's PDF for the lab canvas; a dataset PDF only while it matches its manifest, and, with
 * `?sha256=`, only while it is still the document an essai read (verdict evidence).
 */
export async function GET(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    await requireTakeoffLabAccess();
    const expected = new URL(request.url).searchParams.get("sha256");
    if (expected !== null && !/^[0-9a-f]{64}$/.test(expected)) throw badRequest("SHA-256 attendu invalide.");
    const document = await readLabDocument((await params).documentId, expected === null ? {} : { expectedSha256: expected });
    return new Response(new Uint8Array(document.bytes), {
      headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return labErrorResponse(error);
  }
}
