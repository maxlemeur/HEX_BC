// One entry for the three originals the dossier keeps: a DXF is read as a
// drawing, a DWG and an RVT are summed up. The name says which reader to try
// and the content must agree: a file is never read as what it is not.

import { CadReadError, readDxf, type CadLimits } from "./dxf";
import type { CadDrawing } from "./model";
import { readDwgSummary, readRvtSummary, type CadSummary } from "./summary";

export type CadOriginalFormat = "dxf" | "dwg" | "rvt";

export type CadOriginal = { kind: "drawing"; drawing: CadDrawing } | { kind: "summary"; summary: CadSummary };

export function cadOriginalFormat(fileName: string): CadOriginalFormat | null {
  const extension = /\.([a-z]{3})$/i.exec(fileName.trim())?.[1].toLowerCase();
  return extension === "dxf" || extension === "dwg" || extension === "rvt" ? extension : null;
}

export function readCadOriginal(fileName: string, bytes: Uint8Array, options: { limits?: Partial<CadLimits> } = {}): CadOriginal {
  const format = cadOriginalFormat(fileName);
  if (format === "dxf") return { kind: "drawing", drawing: readDxf(bytes, options) };
  if (format === "dwg") return { kind: "summary", summary: readDwgSummary(bytes) };
  if (format === "rvt") return { kind: "summary", summary: readRvtSummary(bytes) };
  throw new CadReadError("unsupported");
}
