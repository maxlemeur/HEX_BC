// What a DWG or an RVT says without its geometry being read: the release that
// wrote it and the preview image the software left inside. Reading a DWG's
// entities needs a converter and an RVT's needs Revit itself; until then this
// is what the dossier shows of these originals. Nothing else leaves the file:
// an RVT also names its author and the paths of his machine, which are not read out.

import { isCfb, openCfb } from "./cfb";
import { CadReadError } from "./dxf";
import { ACAD_VERSIONS } from "./dxf-records";
import type { CadModel } from "./fcstd";

export type CadThumbnail = { type: "image/png" | "image/bmp"; bytes: Uint8Array };

export type CadSummary = {
  format: "dwg" | "rvt" | "fcstd";
  /** Null when the file does not say. */
  version: { code: string; label: string } | null;
  thumbnail: CadThumbnail | null;
  /** The objects of a FreeCAD document, with the dimensions it wrote for them. */
  model?: CadModel;
};

const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
/** How far the preview of a DWG is looked for when its header points elsewhere. */
const DWG_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_INFO_BYTES = 64 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DWG_PREVIEW_SENTINEL = [0x1f, 0x25, 0x6d, 0x07, 0xd4, 0x36, 0x28, 0x28, 0x9d, 0x57, 0xca, 0x3f, 0x9d, 0x44, 0x10, 0x2b];
const DWG_BITMAP = 2, DWG_PNG = 6;

const matchesAt = (bytes: Uint8Array, pattern: number[], at: number) =>
  at >= 0 && at + pattern.length <= bytes.length && pattern.every((value, index) => bytes[at + index] === value);

function indexOfBytes(bytes: Uint8Array, pattern: number[], end: number): number {
  for (let at = bytes.indexOf(pattern[0]); at >= 0 && at + pattern.length <= end; at = bytes.indexOf(pattern[0], at + 1)) {
    if (matchesAt(bytes, pattern, at)) return at;
  }
  return -1;
}

/** The PNG that starts at `at`, chunk by chunk to its end; null when it is not whole before `end`. */
function pngAt(bytes: Uint8Array, at: number, end: number): Uint8Array | null {
  if (!matchesAt(bytes, PNG_SIGNATURE, at)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let chunk = at + PNG_SIGNATURE.length; chunk + 12 <= end;) {
    const next = chunk + 12 + view.getUint32(chunk, false);
    if (next > end || next - at > MAX_THUMBNAIL_BYTES) return null;
    // « IEND » closes the image: what follows in the stream is not part of it.
    if (view.getUint32(chunk + 4, false) === 0x49454e44) return bytes.slice(at, next);
    chunk = next;
  }
  return null;
}

/** A DWG holds its bitmap without the 14-byte header of a .bmp file: it is put back, with the place of the pixels. */
function bmpFile(dib: Uint8Array): Uint8Array | null {
  if (dib.length < 40) return null;
  const view = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = view.getUint32(0, true), bitCount = view.getUint16(14, true), used = view.getUint32(32, true);
  if (headerSize < 40 || headerSize > 124 || ![1, 4, 8, 16, 24, 32].includes(bitCount)) return null;
  const bitfields = view.getUint32(16, true) === 3 && headerSize === 40 ? 12 : 0;
  const palette = bitCount <= 8 ? 4 * (used > 0 && used <= 1 << bitCount ? used : 1 << bitCount) : bitfields;
  if (headerSize + palette >= dib.length) return null;
  const file = new Uint8Array(14 + dib.length), out = new DataView(file.buffer);
  file[0] = 0x42; file[1] = 0x4d;
  out.setUint32(2, file.length, true);
  out.setUint32(10, 14 + headerSize + palette, true);
  file.set(dib, 14);
  return file;
}

function dwgThumbnail(bytes: Uint8Array): CadThumbnail | null {
  if (bytes.length < 0x11) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const announced = view.getUint32(0x0d, true);
  const at = matchesAt(bytes, DWG_PREVIEW_SENTINEL, announced) ? announced : indexOfBytes(bytes, DWG_PREVIEW_SENTINEL, Math.min(bytes.length, DWG_SCAN_BYTES));
  // After the sentinel: the size of the section, the number of images, then code, address and size of each.
  const table = at + DWG_PREVIEW_SENTINEL.length + 4;
  if (at < 0 || table >= bytes.length) return null;
  let bitmap: Uint8Array | null = null;
  for (let index = 0, entry = table + 1; index < bytes[table] && entry + 9 <= bytes.length; index += 1, entry += 9) {
    const code = bytes[entry], start = view.getUint32(entry + 1, true), size = view.getUint32(entry + 5, true);
    if (size === 0 || size > MAX_THUMBNAIL_BYTES || start + size > bytes.length) continue;
    if (code === DWG_PNG) {
      const png = pngAt(bytes, start, start + size);
      if (png) return { type: "image/png", bytes: png };
    } else if (code === DWG_BITMAP) bitmap ??= bmpFile(bytes.subarray(start, start + size));
  }
  return bitmap ? { type: "image/bmp", bytes: bitmap } : null;
}

export function readDwgSummary(bytes: Uint8Array): CadSummary {
  if (bytes.length === 0) throw new CadReadError("empty");
  const code = String.fromCharCode(...bytes.subarray(0, 6));
  if (!/^AC[0-9.]{4}$/.test(code)) throw new CadReadError("not_dwg");
  return { format: "dwg", version: { code, label: ACAD_VERSIONS[code] ?? code }, thumbnail: dwgThumbnail(bytes) };
}

/** Year of the release, from the text of « BasicFileInfo »: « Format: 2022 », or « Autodesk Revit 2016 » before that field existed. */
function revitYear(info: Uint8Array): string | null {
  // The text is UTF-16 after a binary head whose length varies: it is read at both alignments.
  for (const text of [0, 1].map((shift) => new TextDecoder("utf-16le").decode(info.subarray(shift)))) {
    const year = (/Format:\s*(20\d{2})\b/.exec(text) ?? /Autodesk Revit(?: [A-Za-z]+)* (20\d{2})\b/.exec(text))?.[1];
    if (year) return year;
  }
  return null;
}

export function readRvtSummary(bytes: Uint8Array): CadSummary {
  if (bytes.length === 0) throw new CadReadError("empty");
  if (!isCfb(bytes)) throw new CadReadError("not_rvt");
  const file = openCfb(bytes);
  const info = file?.read("BasicFileInfo", MAX_INFO_BYTES), preview = file?.read("RevitPreview4.0", MAX_THUMBNAIL_BYTES);
  const year = info ? revitYear(info) : null;
  const at = preview ? indexOfBytes(preview, PNG_SIGNATURE, preview.length) : -1;
  const png = preview && at >= 0 ? pngAt(preview, at, preview.length) : null;
  return { format: "rvt", version: year ? { code: year, label: `Revit ${year}` } : null, thumbnail: png ? { type: "image/png", bytes: png } : null };
}
