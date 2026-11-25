// The automatic transcription of a piece at arrival, written before its code: which pages need a reading (an
// image, the scanned pages of a PDF, never a page that already has text), the bound per piece, and what a reading
// that stops records. The PDFs are fictional pdf-lib documents read by the real page reader.
import { PDFDocument, PDFName, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  INTAKE_TRANSCRIPTION_MAX_PAGES, countIllegiblePassages, needsIntakeTranscription, summarizeIntakeTranscription,
} from "@/lib/affaires/intake-transcription";
import { IntakeRetryReadings, planIntakeTranscription, scannedPdfPages } from "@/lib/affaires/intake-transcription-server";

const SPAWN = { timeout: 60_000 } as const;

/** A fictional PDF: `t` is a page of text, `s` a page that is only a raster (a scan). */
async function pdf(pages: string) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const raster = doc.context.register(doc.context.flateStream(new Uint8Array((400 / 8) * 400).fill(0x55), {
    Type: "XObject", Subtype: "Image", Width: 400, Height: 400, ColorSpace: "DeviceGray", BitsPerComponent: 1,
  }));
  for (const [index, kind] of [...pages].entries()) {
    const page = doc.addPage([595, 842]);
    if (kind === "t") page.drawText(`Article ${index + 1} : tube cuivre DN20, raccords a sertir, essais de pression.`, { x: 40, y: 760, size: 11, font });
    else {
      page.node.setXObject(PDFName.of("Im0"), raster);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(500, 0, 0, 500, 47, 171), drawObject("Im0"), popGraphicsState());
    }
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("pages an automatic transcription reads", () => {
  it("reads only the scanned pages of a PDF, each sent alone as a one-page PDF", SPAWN, async () => {
    const plan = await planIntakeTranscription({ mimeType: "application/pdf", bytes: await pdf("tsts") });
    expect(plan?.pagesNeeded).toBe(2);
    expect(plan?.pagesSkipped).toBe(0);
    expect(plan?.pages.map((page) => page.page)).toEqual([2, 4]);
    for (const page of plan!.pages) {
      const file = await page.file();
      expect(file?.mimeType).toBe("application/pdf");
      const sent = await PDFDocument.load(Buffer.from(file!.data, "base64"));
      expect(sent.getPageCount()).toBe(1);
    }
  });

  it("reads nothing in a PDF whose pages all have their text", SPAWN, async () => {
    expect(await planIntakeTranscription({ mimeType: "application/pdf", bytes: await pdf("ttt") })).toBeNull();
  });

  it("reads the first scanned pages up to the bound and counts the others as left out", SPAWN, async () => {
    const plan = await planIntakeTranscription({ mimeType: "application/pdf", bytes: await pdf(`t${"s".repeat(INTAKE_TRANSCRIPTION_MAX_PAGES + 3)}`) });
    expect(plan?.pages).toHaveLength(INTAKE_TRANSCRIPTION_MAX_PAGES);
    expect(plan?.pages[0].page).toBe(2);
    expect(plan?.pagesNeeded).toBe(INTAKE_TRANSCRIPTION_MAX_PAGES + 3);
    expect(plan?.pagesSkipped).toBe(3);
  });

  it("reads an image whole, as one page", async () => {
    const plan = await planIntakeTranscription({ mimeType: "image/png; charset=binary", bytes: bytesOf("png-fixture") });
    expect(plan).toMatchObject({ pagesNeeded: 1, pagesSkipped: 0, pages: [{ page: 1 }] });
    const file = await plan!.pages[0].file();
    expect(file).toEqual({ mimeType: "image/png", data: Buffer.from("png-fixture").toString("base64"), detail: "high" });
  });

  it("reads neither a text file, a spreadsheet nor an unreadable PDF", SPAWN, async () => {
    expect(await planIntakeTranscription({ mimeType: "text/plain", bytes: bytesOf("Tube cuivre") })).toBeNull();
    expect(await planIntakeTranscription({ mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: bytesOf("PK") })).toBeNull();
    expect(await planIntakeTranscription({ mimeType: "application/pdf", bytes: bytesOf("%PDF-1.7 broken") })).toBeNull();
  });
});

describe("a PDF whose pages could not all be checked", () => {
  const page = (number: number, text: string, failed = false) => ({ page: number, text, failed });

  it("counts the pages a stopped text pass never reached, so the reading cannot be complete", () => {
    expect(scannedPdfPages({ pageCount: 5, pages: [page(1, "")] })).toEqual({ scanned: [1], uninspected: 4 });
  });

  it("counts a page that failed as not checked, never as a text page", () => {
    expect(scannedPdfPages({ pageCount: 3, pages: [page(1, ""), page(2, "", true), page(3, "Article 3 : tube cuivre DN20, essais")] }))
      .toEqual({ scanned: [1], uninspected: 1 });
  });

  it("leaves out nothing when every checked page was read, even past the checked range", () => {
    expect(scannedPdfPages({ pageCount: 2, pages: [page(1, ""), page(2, "Article 2 : vanne d'isolement DN20")] })).toEqual({ scanned: [1], uninspected: 0 });
    expect(scannedPdfPages({ pageCount: 300, pages: Array.from({ length: 200 }, (_, i) => page(i + 1, i ? "Article : tube cuivre DN20, essais" : "")) }))
      .toEqual({ scanned: [1], uninspected: 0 });
  });
});

describe("what a transcription records", () => {
  const page = (number: number, text: string) => ({ page: number, text });

  it("counts the passages the model marked illegible instead of guessing them", () => {
    expect(countIllegiblePassages("Tube [illisible] DN20, [ILLISIBLE] m, [illisible]")).toBe(3);
    expect(countIllegiblePassages("Tube cuivre DN20")).toBe(0);
  });

  it("is completed when every page it needed was read", () => {
    expect(summarizeIntakeTranscription({ pagesNeeded: 2, pagesSkipped: 0, read: [page(2, "A [illisible]"), page(4, "")], errorCode: null }))
      .toEqual({ status: "completed", pages: [{ page: 2, text: "A [illisible]", illegible: 1 }, { page: 4, text: "", illegible: 0 }],
        pages_needed: 2, pages_skipped: 0, error_code: null });
  });

  it("is partial when the bound or a failure left pages unread, and keeps why it stopped", () => {
    expect(summarizeIntakeTranscription({ pagesNeeded: 25, pagesSkipped: 5, read: Array.from({ length: 20 }, (_, i) => page(i + 1, "x")), errorCode: null }))
      .toMatchObject({ status: "partial", pages_needed: 25, pages_skipped: 5, error_code: null });
    expect(summarizeIntakeTranscription({ pagesNeeded: 3, pagesSkipped: 0, read: [page(1, "x")], errorCode: "AI_QUOTA" }))
      .toMatchObject({ status: "partial", pages_skipped: 0, error_code: "AI_QUOTA" });
  });

  it("is failed, with no text, when no page was read", () => {
    expect(summarizeIntakeTranscription({ pagesNeeded: 1, pagesSkipped: 0, read: [], errorCode: "MODEL_UNAVAILABLE" }))
      .toEqual({ status: "failed", pages: [], pages_needed: 1, pages_skipped: 0, error_code: "MODEL_UNAVAILABLE" });
  });
});

describe("when a piece is read again", () => {
  const sha = "a".repeat(64);
  it("reads a piece with no reading, or whose reading was of another content", () => {
    expect(needsIntakeTranscription(null, sha)).toBe(true);
    expect(needsIntakeTranscription({ source_sha256: "b".repeat(64), error_code: null }, sha)).toBe(true);
  });
  it("keeps a reading of the same content that ended without an error, the per-piece bound included", () => {
    expect(needsIntakeTranscription({ source_sha256: sha, error_code: null }, sha)).toBe(false);
  });
  it.each(["AI_QUOTA", "AI_RATE_LIMIT", "AI_AUTH_REQUIRED", "MODEL_UNAVAILABLE", "PROVIDER_ERROR", "PDF_INSPECTION_INCOMPLETE"])(
    "reads again a reading stopped by %s, which may clear", (code) => {
      expect(needsIntakeTranscription({ source_sha256: sha, error_code: code }, sha)).toBe(true);
    });
  it("keeps a reading of the same content whose page was too heavy: the same bytes stay too heavy", () => {
    expect(needsIntakeTranscription({ source_sha256: sha, error_code: "PAGE_TOO_LARGE" }, sha)).toBe(false);
  });
});

describe("deferred reading reservations on this host", () => {
  it("registers a deferred reading once per document reservation", () => {
    const readings = new IntakeRetryReadings();
    const first = readings.claim("doc-1", "reservation-a");
    expect(first).not.toBeNull();
    expect(readings.claim("doc-1", "reservation-a")).toBeNull();
    expect(readings.isRunning("doc-1")).toBe(true);
    expect(readings.isRunning("doc-2")).toBe(false);
  });

  it("a newer reservation supersedes an older callback, even on the same document", () => {
    const readings = new IntakeRetryReadings();
    const older = readings.claim("doc-1", "reservation-a")!;
    const newer = readings.claim("doc-1", "reservation-b")!;
    expect(readings.isCurrent("doc-1", older)).toBe(false);
    expect(readings.isCurrent("doc-1", newer)).toBe(true);
    // The older reading ends first: it does not release the newer one.
    readings.release("doc-1", older);
    expect(readings.isRunning("doc-1")).toBe(true);
    readings.release("doc-1", newer);
    expect(readings.isRunning("doc-1")).toBe(false);
    expect(readings.claim("doc-1", "reservation-a")).not.toBeNull();
  });
});
