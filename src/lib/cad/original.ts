// One entry for the originals the dossier keeps: a DXF is read as a drawing, a
// DWG and an RVT are summed up, and a FreeCAD document is summed up with its
// objects, or drawn by its sketches when it has some. The name says which
// reader to try and the content must agree: a file is never read as what it is not.

import { CadReadError, readDxf, type CadLimits } from "./dxf";
import { readFcstd, type FcstdLimits } from "./fcstd";
import type { CadDrawing, CadWarning } from "./model";
import { readDwgSummary, readRvtSummary, type CadSummary } from "./summary";

export type CadOriginalFormat = "dxf" | "dwg" | "rvt" | "fcstd";

export type CadOriginal =
  /** `source`: the FreeCAD document whose sketches the drawing is. */
  | { kind: "drawing"; drawing: CadDrawing; source?: CadSummary }
  | { kind: "summary"; summary: CadSummary };

export function cadOriginalFormat(fileName: string): CadOriginalFormat | null {
  const extension = /\.([a-z]{3,5})$/i.exec(fileName.trim())?.[1].toLowerCase();
  return extension === "dxf" || extension === "dwg" || extension === "rvt" || extension === "fcstd" ? extension : null;
}

/** `limits`: those of the drawing reader; `fcstdLimits`: those of the FreeCAD reader. */
export async function readCadOriginal(fileName: string, bytes: Uint8Array, options: { limits?: Partial<CadLimits>; fcstdLimits?: Partial<FcstdLimits> } = {}): Promise<CadOriginal> {
  const format = cadOriginalFormat(fileName);
  if (format === "dxf") return { kind: "drawing", drawing: readDxf(bytes, options) };
  if (format === "dwg") return { kind: "summary", summary: readDwgSummary(bytes) };
  if (format === "rvt") return { kind: "summary", summary: readRvtSummary(bytes) };
  if (format === "fcstd") {
    const { summary, sketchesDxf } = await readFcstd(bytes, { limits: options.fcstdLimits });
    if (sketchesDxf === null) return { kind: "summary", summary };
    try {
      const drawing = readDxf(new TextEncoder().encode(sketchesDxf), { limits: options.limits });
      // Sketches of which elements were left out, by a limit or for being of a kind that is not drawn, make a drawing read in part:
      // it says why, its quantities are a minimum, and it is not plotted as a whole plan.
      const { left } = summary.model;
      const missing: CadWarning[] = [...(left.sketches ? [{ code: "sketch_limit" as const }] : []), ...(left.unread ? [{ code: "sketch_unread" as const }] : [])];
      return { kind: "drawing", drawing: missing.length > 0 ? { ...drawing, truncated: true, warnings: [...drawing.warnings, ...missing] } : drawing, source: summary };
    } catch (error) {
      if (!(error instanceof CadReadError)) throw error;
      // Sketches too heavy to be read as a drawing: the document is summed up, and says that they are not drawn.
      return { kind: "summary", summary: { ...summary, model: { ...summary.model, sketches: 0, truncated: true, left: { ...summary.model.left, sketches: true } } } };
    }
  }
  throw new CadReadError("unsupported");
}
