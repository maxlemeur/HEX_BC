import "server-only";

import { readAffaireDocumentPreview } from "@/lib/affaires/intake-document-preview";
import { DwgConversionError, dwgConversionMessage } from "@/lib/cad/dwg-conversion";
import { convertDwgToDxf } from "@/lib/cad/dwg-conversion-server";
import { ApiError, badRequest, unprocessableEntity } from "@/lib/estimates/errors";

/**
 * The DXF of a DWG of the dossier, for the viewer to read. The piece is read
 * with the tenant and project boundary of its preview; the DXF is made on the
 * way and kept nowhere. `signal`: who asked has left, and the conversion is ended.
 */
export async function readAffaireDocumentDrawing(projectId: string, documentId: string, signal?: AbortSignal) {
  const document = await readAffaireDocumentPreview(projectId, documentId, true);
  if (!/\.dwg$/i.test(document.fileName.trim())) {
    throw badRequest("Seul un DWG est converti : les autres plans s’ouvrent tels quels.", undefined, "CAD_DRAWING_NOT_DWG");
  }
  try {
    return { bytes: await convertDwgToDxf(document.bytes, { signal }), fileName: document.fileName };
  } catch (error) {
    if (error instanceof DwgConversionError) {
      const code = `DWG_CONVERSION_${error.reason.toUpperCase()}`;
      // A busy server is asked again; a file it does not convert is not.
      if (error.reason === "busy") throw new ApiError({ status: 503, code, message: dwgConversionMessage(error.reason) });
      throw unprocessableEntity(dwgConversionMessage(error.reason), undefined, code);
    }
    throw error;
  }
}
