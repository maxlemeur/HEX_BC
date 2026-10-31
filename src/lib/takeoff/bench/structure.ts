import { crc32, inflateRawSync } from "node:zlib";

// Structure checks of the takeoff bench binaries (TI-659 section 3). A truncated
// or undecoded download can be recorded with its own size and hash at inventory,
// so the size and the SHA-256 alone do not prove that the file is usable:
// - PDF: `%PDF-` in the first 1024 bytes, `%%EOF` in the last 1024, and pdfjs
//   opens it with the page count the manifest records (page ranges and page
//   truths are bounded by that count);
// - XLSX: the ZIP central directory holds the workbook parts, and every entry
//   inflates to its recorded size and CRC-32, as `unzip -tq` does.
// Each function returns the first problem as a message, or null.

const PDF_EDGE_BYTES = 1024;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfJs: Promise<PdfJs> | null = null;

export async function pdfStructureError(bytes: Buffer, expectedPages: number | null) {
  if (!bytes.subarray(0, PDF_EDGE_BYTES).toString("latin1").includes("%PDF-")) {
    return "no %PDF- header in the first 1024 bytes (undecoded base64 or not a PDF?)";
  }
  if (!bytes.subarray(Math.max(0, bytes.length - PDF_EDGE_BYTES)).toString("latin1").includes("%%EOF")) {
    return "no %%EOF marker in the last 1024 bytes (truncated download?)";
  }
  pdfJs ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  const { getDocument, VerbosityLevel } = await pdfJs;
  // pdfjs takes ownership of the array it is given: hand it a copy.
  const task = getDocument({
    data: new Uint8Array(bytes),
    stopAtErrors: true,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    const { numPages } = await task.promise;
    if (expectedPages !== null && numPages !== expectedPages) {
      return `pdfjs opens ${numPages} page${numPages === 1 ? "" : "s"}, the manifest says ${expectedPages}`;
    }
    return null;
  } catch (error) {
    return `pdfjs cannot open it: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await task.destroy();
  }
}

const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_ENTRY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

type ZipEntry = { name: string; method: number; crc: number; compressedSize: number; size: number; localOffset: number };

function zipEntryError(bytes: Buffer, entry: ZipEntry, directoryStart: number) {
  const { name, localOffset } = entry;
  if (localOffset + 30 > directoryStart || bytes.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
    return `workbook entry ${name}: corrupt local header`;
  }
  const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
  if (dataStart + entry.compressedSize > directoryStart) return `workbook entry ${name}: data runs past the central directory`;
  const data = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  let content: Buffer;
  if (entry.method === 0) {
    content = data;
  } else if (entry.method === 8) {
    try {
      content = inflateRawSync(data, { maxOutputLength: entry.size + 1 });
    } catch (error) {
      return `workbook entry ${name} cannot be inflated (${(error as Error).message})`;
    }
  } else {
    return `workbook entry ${name}: unexpected compression method ${entry.method}`;
  }
  if (content.length !== entry.size) return `workbook entry ${name}: ${content.length} bytes, the archive says ${entry.size}`;
  if (crc32(content) !== entry.crc) return `workbook entry ${name} fails its CRC-32 (corrupt archive)`;
  return null;
}

export function xlsxStructureError(bytes: Buffer) {
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_SIGNATURE) {
      end = offset;
      break;
    }
  }
  if (end < 0) return "not a ZIP archive: no end of central directory (undecoded base64 or truncated download?)";
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) return "ZIP64 archive: not an expected XLSX";
  if (start + size > end) return "ZIP central directory overlaps its end record";
  const entries: ZipEntry[] = [];
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== ZIP_ENTRY_SIGNATURE) return "corrupt ZIP central directory entry";
    const nameLength = bytes.readUInt16LE(cursor + 28);
    entries.push({
      name: bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      method: bytes.readUInt16LE(cursor + 10),
      crc: bytes.readUInt32LE(cursor + 16),
      compressedSize: bytes.readUInt32LE(cursor + 20),
      size: bytes.readUInt32LE(cursor + 24),
      localOffset: bytes.readUInt32LE(cursor + 42),
    });
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  if (cursor !== start + size) return "ZIP central directory size does not match its entries";
  const names = new Set(entries.map((entry) => entry.name));
  for (const required of ["[Content_Types].xml", "xl/workbook.xml"]) {
    if (!names.has(required)) return `ZIP archive without ${required}: not an XLSX workbook`;
  }
  for (const entry of entries) {
    const error = zipEntryError(bytes, entry, start);
    if (error) return error;
  }
  return null;
}
