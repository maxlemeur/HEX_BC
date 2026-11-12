// The intake sample of a scanned PDF (TI-715), written before the fix, on the
// real page reader and fictional pdf-lib scans: a first page that is nothing
// but a raster above the bound the reader decodes (8 MP) used to be sent to
// Decisions as a white picture, with no issue; a scan under the bound must
// still be sent as before.
import { PDFDocument, PDFName, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildIntakeDecisionEvidence } from "@/lib/affaires/intake-decision-evidence";

const SPAWN = { timeout: 60_000 } as const;

/** One A4 page drawn by a single 1-bit raster: white above the bound (16 MP, a few kilobytes), black under it. */
async function scan(side: number) {
  const doc = await PDFDocument.create();
  const fill = side > 3000 ? 0xff : 0x00;
  const raster = doc.context.register(doc.context.flateStream(new Uint8Array((side / 8) * side).fill(fill), {
    Type: "XObject", Subtype: "Image", Width: side, Height: side, ColorSpace: "DeviceGray", BitsPerComponent: 1,
  }));
  const page = doc.addPage([595, 842]);
  page.node.setXObject(PDFName.of("Im0"), raster);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(500, 0, 0, 500, 47, 171), drawObject("Im0"), popGraphicsState());
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("intake sample of a scanned PDF", () => {
  it("sends no white picture for a scan above the decoded bound and says the preview lacks it", SPAWN, async () => {
    const evidence = await buildIntakeDecisionEvidence({ mimeType: "application/pdf", bytes: await scan(4000) });
    expect(evidence.images).toEqual([]);
    expect(evidence.issues).toContain("L’aperçu du PDF omet une image trop lourde ou illisible : la catégorie reste à confirmer.");
  });

  it("sends the first-page picture of a scan under the bound, without that issue", SPAWN, async () => {
    const evidence = await buildIntakeDecisionEvidence({ mimeType: "application/pdf", bytes: await scan(1000) });
    expect(evidence.images).toHaveLength(1);
    expect(evidence.issues.some((issue) => issue.includes("image trop lourde"))).toBe(false);
  });
});
