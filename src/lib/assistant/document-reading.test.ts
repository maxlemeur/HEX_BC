import { randomBytes } from "node:crypto";
import { degrees, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { AssistantDocumentLedger } from "@/lib/assistant/document-citations";
import { DOCUMENT_READ_LIMITS, documentReadType, prepareDocumentRead } from "@/lib/assistant/document-reading";
import { AssistantToolError } from "@/lib/assistant/loop";

/** A fictional PDF whose page N says « Article N ». */
async function pdfOf(pages: number, options: { padding?: number } = {}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = document.addPage([595, 842]);
    page.drawText(`Article ${index}`, { x: 50, y: 780, size: 14, font });
    // Noise that compression cannot remove, to make a page heavy on purpose.
    if (options.padding) {
      const noise = Array.from({ length: options.padding }, (_, offset) => String.fromCharCode(33 + ((index * 7919 + offset * 104_729) % 90))).join("");
      for (let row = 0; row * 2_000 < noise.length; row += 1) page.drawText(noise.slice(row * 2_000, row * 2_000 + 2_000), { x: 10, y: 10, size: 1, font });
    }
  }
  return new Uint8Array(await document.save());
}

async function pagesOf(part: Record<string, unknown>) {
  const data = String(part.file_data);
  expect(data.startsWith("data:application/pdf;base64,JVBER")).toBe(true);
  const sent = await PDFDocument.load(Buffer.from(data.slice("data:application/pdf;base64,".length), "base64"));
  return sent.getPageCount();
}

/** The request carrying what was read has gone and succeeded: the next read starts a new round. */
function nextRequest(ledger: AssistantDocumentLedger) {
  ledger.requestStarting();
  ledger.requestSucceeded();
}

const read = (bytes: Uint8Array, input: Partial<Parameters<typeof prepareDocumentRead>[0]> = {}) => prepareDocumentRead({
  documentId: "11111111-1111-4111-8111-111111111111", fileName: "CCTP lot plomberie.pdf", mimeType: "application/pdf", bytes, ledger: new AssistantDocumentLedger(), ...input,
});

describe("reading a document for the assistant", () => {
  it("sends a small PDF whole, as the file part the classification already sends", async () => {
    const result = await read(await pdfOf(3));
    expect(result).toMatchObject({ pagesTotal: 3, from: 1, to: 3, cut: null, nextPage: null, text: null });
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ type: "input_file", filename: "document.pdf" });
    expect(await pagesOf(result.parts[0]!)).toBe(3);
  });

  it("sends only the asked range, and says which pages of the document the file holds", async () => {
    const result = await read(await pdfOf(12), { pageStart: 4, pageEnd: 6 });
    expect(result).toMatchObject({ pagesTotal: 12, from: 4, to: 6, cut: null, nextPage: null });
    expect(await pagesOf(result.parts[0]!)).toBe(3);
  });

  it("cuts a long document at the page limit and tells where to resume", async () => {
    const result = await read(await pdfOf(40), { pageStart: 5 });
    expect(result).toMatchObject({ pagesTotal: 40, from: 5, to: 4 + DOCUMENT_READ_LIMITS.pagesPerRead, cut: "pages", nextPage: 5 + DOCUMENT_READ_LIMITS.pagesPerRead });
    expect(await pagesOf(result.parts[0]!)).toBe(DOCUMENT_READ_LIMITS.pagesPerRead);
  });

  it("sends fewer pages when they weigh more than one read may carry", async () => {
    const bytes = await pdfOf(6, { padding: 60_000 });
    const result = await read(bytes, { limits: { ...DOCUMENT_READ_LIMITS, bytesPerRead: Math.ceil(bytes.byteLength / 2.5) } });
    expect(result.cut).toBe("bytes");
    expect(result.to - result.from + 1).toBeLessThan(6);
    expect(result.nextPage).toBe(result.to + 1);
    expect(result.bytes).toBeLessThanOrEqual(Math.ceil(bytes.byteLength / 2.5));
  });

  it("refuses a page that alone is too heavy, without sending anything", async () => {
    const bytes = await pdfOf(1, { padding: 60_000 });
    const ledger = new AssistantDocumentLedger();
    const attempt = read(bytes, { ledger, limits: { ...DOCUMENT_READ_LIMITS, bytesPerRead: 1_000 } });
    await expect(attempt).rejects.toBeInstanceOf(AssistantToolError);
    await expect(attempt).rejects.toThrow("trop lourde");
    expect(ledger.budget()).toEqual({ pagesLeft: DOCUMENT_READ_LIMITS.pagesPerTurn, bytesLeft: DOCUMENT_READ_LIMITS.bytesPerTurn });
  });

  it("refuses a page past the end and names the page count", async () => {
    await expect(read(await pdfOf(3), { pageStart: 7 })).rejects.toThrow("3 pages");
  });

  it("stops at the turn's budget: the pages already sent are spent, the next read is cut or refused", async () => {
    const ledger = new AssistantDocumentLedger();
    const limits = { ...DOCUMENT_READ_LIMITS, pagesPerTurn: 12 };
    const bytes = await pdfOf(30);
    const first = await read(bytes, { ledger, limits });
    expect(first.to).toBe(10);
    nextRequest(ledger);
    const second = await read(bytes, { ledger, limits, pageStart: 11 });
    expect(second).toMatchObject({ from: 11, to: 12, cut: "budget", nextPage: 13 });
    nextRequest(ledger);
    await expect(read(bytes, { ledger, limits, pageStart: 13 })).rejects.toThrow("Limite de pages");
  });

  it("refuses a PDF it cannot open", async () => {
    await expect(read(new TextEncoder().encode("%PDF-1.7 pas vraiment un PDF"))).rejects.toThrow("ne peut pas être lu");
  });

  it("gives a text file as text, cut and flagged past its limit", async () => {
    const text = "Article 1 — ".padEnd(DOCUMENT_READ_LIMITS.textCharacters + 50, "x");
    const result = await read(new TextEncoder().encode(text), { fileName: "notes.txt", mimeType: "text/plain" });
    expect(result).toMatchObject({ pagesTotal: 1, from: 1, to: 1, cut: "characters", parts: [] });
    expect(result.text).toHaveLength(DOCUMENT_READ_LIMITS.textCharacters);
  });

  it("sends an image as the image part the classification already sends", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const result = await read(png, { fileName: "facade.png", mimeType: "image/png" });
    expect(result).toMatchObject({ pagesTotal: 1, from: 1, to: 1, text: null });
    expect(result.parts).toEqual([{ type: "input_image", image_url: `data:image/png;base64,${Buffer.from(png).toString("base64")}` }]);
  });

  it("refuses a format it does not read, and says what to do instead", async () => {
    await expect(read(new Uint8Array([1, 2, 3]), { fileName: "DPGF.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }))
      .rejects.toThrow("pas encore lu");
  });
  it("cuts a text file by what its result weighs once encoded, so that the model always gets what is recorded as read", async () => {
    const text = "\u0001".repeat(DOCUMENT_READ_LIMITS.textCharacters);
    const result = await read(new TextEncoder().encode(text), { fileName: "notes.txt", mimeType: "text/plain" });
    expect(result.cut).toBe("characters");
    expect(JSON.stringify(result.text).length).toBeLessThanOrEqual(90_000);
  });

  it("tells whether it can read a document before its bytes are fetched", () => {
    expect(documentReadType("Plan.PDF", "application/octet-stream")).toBe("application/pdf");
    expect(documentReadType("CCTP.pdf", null)).toBe("application/pdf");
    expect(documentReadType("photo.jpg", "image/jpeg; q=1")).toBe("image/jpeg");
    expect(documentReadType("DPGF.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBeNull();
  });
  it("reads a cropped plan shown rotated, keeping its rotation", async () => {
    const plan = await PDFDocument.create();
    const page = plan.addPage([1189, 841]);
    page.setRotation(degrees(90));
    page.setCropBox(40, 40, 1000, 700);
    const result = await read(new Uint8Array(await plan.save()), { fileName: "Plan.pdf" });
    expect(result).toMatchObject({ pagesTotal: 1, from: 1, to: 1, cut: null });
    const sent = await PDFDocument.load(Buffer.from(String(result.parts[0]!.file_data).split(",")[1]!, "base64"));
    expect(sent.getPage(0).getRotation().angle).toBe(90);
  });
  it("continues a long document from where the last read stopped, up to the answer's 30 pages", async () => {
    const bytes = await pdfOf(40);
    const ledger = new AssistantDocumentLedger();
    const first = await read(bytes, { ledger });
    nextRequest(ledger);
    const second = await read(bytes, { ledger, pageStart: first.nextPage! });
    expect([first, second].map(({ from, to, nextPage }) => ({ from, to, nextPage })))
      .toEqual([{ from: 1, to: 10, nextPage: 11 }, { from: 11, to: 20, nextPage: 21 }]);
    nextRequest(ledger);
    await read(bytes, { ledger, pageStart: 21 });
    nextRequest(ledger);
    await expect(read(bytes, { ledger, pageStart: 31 })).rejects.toThrow("Limite de pages");
  });

  it("sends at most one read's worth of pages before the next request, however many reads the model asks at once", async () => {
    const bytes = await pdfOf(40);
    const ledger = new AssistantDocumentLedger();
    await read(bytes, { ledger, pageEnd: 7 });
    const second = await read(bytes, { ledger, pageStart: 8 });
    expect(second).toMatchObject({ from: 8, to: 10, cut: "budget", nextPage: 11 });
    await expect(read(bytes, { ledger, pageStart: 11 })).rejects.toThrow("Limite de pages");
  });

  it("refuses a real page heavier than one read may carry", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    page.node.set(PDFName.of("Contents"), pdf.context.register(pdf.context.stream(randomBytes(DOCUMENT_READ_LIMITS.bytesPerRead + 10_000))));
    await expect(read(new Uint8Array(await pdf.save()))).rejects.toThrow("trop lourde");
  });

  it("refuses an encrypted PDF and a broken one with the same sentence", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.context.trailerInfo.Encrypt = pdf.context.obj({ Filter: "Standard" });
    for (const bytes of [new Uint8Array(await pdf.save()), new TextEncoder().encode("%PDF-1.7 broken")]) {
      await expect(read(bytes)).rejects.toThrow("ne peut pas être lu");
    }
  });

  it("applies what is left of the answer's byte budget to a text file, and says it was cut", async () => {
    const ledger = new AssistantDocumentLedger();
    const image = new Uint8Array(DOCUMENT_READ_LIMITS.bytesPerRead - 5);
    await read(image, { ledger, fileName: "a.png", mimeType: "image/png" });
    nextRequest(ledger);
    await read(image, { ledger, fileName: "b.png", mimeType: "image/png" });
    nextRequest(ledger);
    const text = await read(new TextEncoder().encode("é".repeat(1_000)), { ledger, fileName: "a.txt", mimeType: "text/plain" });
    expect(text.bytes).toBeLessThanOrEqual(10);
    expect(text.cut).toBe("budget");
    // Never half a character.
    expect(text.text).toBe("é".repeat(5));
    nextRequest(ledger);
    await expect(read(new TextEncoder().encode("a"), { ledger, fileName: "b.txt", mimeType: "text/plain" })).rejects.toThrow("Limite de pages");
  });
});
