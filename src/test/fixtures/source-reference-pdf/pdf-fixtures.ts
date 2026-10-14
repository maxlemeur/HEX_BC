import { PDFDocument } from "pdf-lib";

export const PDF_LIMIT_BYTES = 50 * 1024 * 1024;

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

export async function makePagePdf(pageCount: number): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 201) {
    throw new Error("Fixture page count must be in 1..201");
  }
  const document = await PDFDocument.create();
  document.setCreationDate(new Date("2026-10-11T00:00:00.000Z"));
  document.setModificationDate(new Date("2026-10-11T00:00:00.000Z"));
  document.setProducer("ARMY synthetic source-reference PDF corpus");
  for (let page = 0; page < pageCount; page += 1) document.addPage([100, 100]);
  return ownedBuffer(await document.save({ useObjectStreams: false, addDefaultPage: false }));
}

function rawPdf(objects: string[], trailerExtra = ""): ArrayBuffer {
  const encoder = new TextEncoder();
  let text = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(text).byteLength);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = encoder.encode(text).byteLength;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return ownedBuffer(encoder.encode(text));
}

export function makeZeroPagePdf(): ArrayBuffer {
  return rawPdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>"]);
}

export function makeCyclicPageTreePdf(): ArrayBuffer {
  // Only send this fixture to a terminable worker, never parse it in the test process.
  return rawPdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [2 0 R] /Count 1 >>"]);
}

export function makeEncryptionMarkerPdf(): ArrayBuffer {
  // Declared Encrypt dictionary; not claimed to contain genuinely encrypted content.
  const zero = "00".repeat(32);
  return rawPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${zero}> /U <${zero}> /P -4 >>`,
  ], "/Encrypt 4 0 R /ID [<00000000000000000000000000000000><00000000000000000000000000000000>]");
}

export function makeInvalidPdf(): ArrayBuffer {
  return ownedBuffer(new TextEncoder().encode("%PDF-1.7\nno catalog\n%%EOF\n"));
}

export async function makePdfWithExactSize(byteSize: number): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > PDF_LIMIT_BYTES + 1) {
    throw new Error("Fixture byte size outside its bounded corpus");
  }
  const source = await makePagePdf(1);
  if (byteSize < source.byteLength) throw new Error("Requested fixture smaller than its PDF body");
  const output = new ArrayBuffer(byteSize);
  const view = new Uint8Array(output);
  view.fill(0x20); // Whitespace after EOF preserves a valid PDF and exact byte size.
  view.set(new Uint8Array(source));
  return output;
}
