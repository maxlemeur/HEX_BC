import { PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { countPageGeometry } from "./count-marks-view";

// Match PDF.js's visible box: the intersection of CropBox and MediaBox, falling back
// to MediaBox for a disjoint crop. The requested pages always refer to the original PDF.
export async function countMarkPageFrames(bytes: Uint8Array, pages: readonly number[]) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return pages.map((number) => {
    const page = doc.getPage(number - 1);
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    let x0 = Math.max(media.x, crop.x);
    let y0 = Math.max(media.y, crop.y);
    let x1 = Math.min(media.x + media.width, crop.x + crop.width);
    let y1 = Math.min(media.y + media.height, crop.y + crop.height);
    if (x1 <= x0 || y1 <= y0) {
      x0 = media.x;
      y0 = media.y;
      x1 = media.x + media.width;
      y1 = media.y + media.height;
    }
    const angle = ((page.getRotation().angle % 360) + 360) % 360;
    const unit = page.node.lookupMaybe(PDFName.of("UserUnit"), PDFNumber)?.asNumber();
    const geometry = countPageGeometry({
      viewBox: [x0, y0, x1, y1],
      rotation: angle === 90 || angle === 180 || angle === 270 ? angle : 0,
      userUnit: unit && unit > 0 ? unit : 1,
    });
    if (
      geometry.user_unit > 1000 ||
      !(geometry.width > 0 && geometry.width <= 10_000_000) ||
      !(geometry.height > 0 && geometry.height <= 10_000_000) ||
      geometry.view_box.some((coordinate) => Math.abs(coordinate) > 10_000_000)
    ) {
      throw new Error("La géométrie de la page dépasse les limites des repères.");
    }
    return { page: number, geometry };
  });
}
