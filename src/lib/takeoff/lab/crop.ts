import "server-only";

import { PDFDocument } from "pdf-lib";

import { badRequest } from "@/lib/estimates/errors";
import type { LabCrop } from "@/lib/takeoff/lab/contracts";
import { cropBoxFor } from "@/lib/takeoff/lab/geometry";

/**
 * A one-page PDF of `crop.page` (pdf-lib), its CropBox narrowed to the region
 * drawn on the displayed page when there is one. Vectors and text stay intact:
 * the model reads the same page, limited to that region.
 */
export async function cropLabPdf(bytes: Uint8Array, crop: LabCrop): Promise<Uint8Array> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw badRequest("Ce PDF ne peut pas être recadré (chiffré ou illisible).");
  }
  if (crop.page > source.getPageCount()) throw badRequest(`La page ${crop.page} dépasse les ${source.getPageCount()} pages du document.`);
  const output = await PDFDocument.create({ updateMetadata: false });
  const [page] = await output.copyPages(source, [crop.page - 1]);
  output.addPage(page);
  if (crop.box) {
    const view = page.getCropBox();
    const box = cropBoxFor({ left: view.x, bottom: view.y, right: view.x + view.width, top: view.y + view.height },
      page.getRotation().angle, crop.box);
    page.setCropBox(box.left, box.bottom, box.right - box.left, box.top - box.bottom);
  }
  return output.save();
}
