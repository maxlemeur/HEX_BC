import { readLabDocument } from "@/lib/takeoff/lab/dataset";
import { labErrorResponse, requireTakeoffLabAccess } from "@/lib/takeoff/lab/server";

/** The document's PDF for the lab canvas; a dataset PDF only while it matches its manifest. */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    await requireTakeoffLabAccess();
    const document = await readLabDocument((await params).documentId);
    return new Response(new Uint8Array(document.bytes), {
      headers: { "content-type": "application/pdf", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    return labErrorResponse(error);
  }
}
