import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  buildPdfChunks,
  createPdfChunkBytes,
  getPdfPageCount,
  mergeTakeoffChunkExchanges,
} from "@/lib/takeoff/chunking";
import type { TakeoffExchange } from "@/lib/takeoff/types";

async function createPdfWithPages(pageCount: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([595, 842]);
  }
  return pdf.save();
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function createExchange(input: {
  items: TakeoffExchange["items"];
  warnings?: TakeoffExchange["warnings"];
  confidence?: number;
}): TakeoffExchange {
  return {
    items: input.items,
    warnings: input.warnings ?? [],
    metadata: {
      level: "C",
      prompt_version: "takeoff-c-v1",
      file_type: "application/pdf",
      schema_version: "v1",
    },
    confidence: input.confidence ?? 0.8,
  };
}

describe("takeoff chunking", () => {
  it("returns a single chunk when page count stays under threshold", () => {
    const chunks = buildPdfChunks(12, {
      thresholdPages: 15,
      chunkSizePages: 10,
      overlapPages: 2,
    });

    expect(chunks).toEqual([{ index: 0, startPage: 1, endPage: 12 }]);
  });

  it("splits pages with overlap for large PDFs", () => {
    const chunks = buildPdfChunks(28, {
      thresholdPages: 15,
      chunkSizePages: 10,
      overlapPages: 2,
    });

    expect(chunks).toEqual([
      { index: 0, startPage: 1, endPage: 10 },
      { index: 1, startPage: 9, endPage: 18 },
      { index: 2, startPage: 17, endPage: 26 },
      { index: 3, startPage: 25, endPage: 28 },
    ]);
  });

  it("rejects invalid overlap configuration", () => {
    expect(() =>
      buildPdfChunks(30, {
        thresholdPages: 10,
        chunkSizePages: 8,
        overlapPages: 8,
      })
    ).toThrow("chunk_overlap_pages doit etre strictement inferieur a chunk_size_pages.");
  });

  it("reads page counts and creates bounded sub-PDF chunks", async () => {
    const bytes = await createPdfWithPages(6);
    const pageCount = await getPdfPageCount(toArrayBuffer(bytes));
    expect(pageCount).toBe(6);

    const chunkBytes = await createPdfChunkBytes({
      bytes: toArrayBuffer(bytes),
      chunk: {
        index: 0,
        startPage: 2,
        endPage: 4,
      },
    });

    const chunkPageCount = await getPdfPageCount(toArrayBuffer(chunkBytes));
    expect(chunkPageCount).toBe(3);
  });

  it("merges chunk exchanges deterministically and keeps highest confidence", () => {
    const merged = mergeTakeoffChunkExchanges([
      {
        chunk: { index: 0, startPage: 1, endPage: 10 },
        exchange: createExchange({
          items: [
            {
              designation: "Canalisation cuivre",
              quantity: 10,
              unit: "ml",
              source_page: 9,
              source_file: "plan-a.pdf",
              confidence: 0.62,
              evidence: "Chunk 1",
            },
          ],
          warnings: [
            {
              code: "LOW_TEXT_QUALITY",
              message: "OCR partiel.",
              severity: "warning",
            },
          ],
          confidence: 0.7,
        }),
      },
      {
        chunk: { index: 1, startPage: 9, endPage: 18 },
        exchange: createExchange({
          items: [
            {
              designation: "Canalisation cuivre",
              quantity: 11,
              unit: "ml",
              source_page: 9,
              source_file: "plan-a.pdf",
              confidence: 0.91,
              evidence: "Chunk 2",
            },
            {
              designation: "Support mural",
              quantity: 6,
              unit: "u",
              source_page: 15,
              source_file: "plan-a.pdf",
              confidence: 0.83,
              evidence: "Chunk 2",
            },
          ],
          warnings: [
            {
              code: "LOW_TEXT_QUALITY",
              message: "OCR partiel.",
              severity: "warning",
            },
          ],
          confidence: 0.9,
        }),
      },
    ]);

    expect(merged.deduplicatedItems).toBe(2);
    expect(merged.duplicateItems).toBe(1);
    expect(merged.exchange.warnings).toEqual([
      {
        code: "LOW_TEXT_QUALITY",
        message: "OCR partiel.",
        severity: "warning",
      },
    ]);
    expect(merged.exchange.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          designation: "Canalisation cuivre",
          quantity: 11,
          confidence: 0.91,
          evidence: "Chunk 1 | Chunk 2",
        }),
        expect.objectContaining({
          designation: "Support mural",
          quantity: 6,
        }),
      ])
    );
  });
});
