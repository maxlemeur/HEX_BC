import { describe, expect, it, vi } from "vitest";

import type { Worker as NodeWorker } from "node:worker_threads";

import {
  __testing__,
  detectTabularPdfTablesFromLayout,
} from "@/lib/imports/tabular-pdf-extraction";

describe("detectTabularPdfTablesFromLayout", () => {
  it("splits tables per page when layout output contains form feeds", () => {
    const result = detectTabularPdfTablesFromLayout(
      [
        "Code     Description",
        "A-001    Cable",
        "\f",
        "Code     Description",
        "A-002    Gaine",
      ].join("\n")
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.source_page).toBe(1);
    expect(result[1]?.source_page).toBe(2);
  });

  it("keeps narrow rendered cells separated when rebuilding layout text", () => {
    const layoutText = __testing__.buildPageLayoutText({
      items: [
        {
          str: "Code",
          transform: [1, 0, 0, 1, 40, 120],
          width: 24,
          height: 12,
          hasEOL: false,
        },
        {
          str: "Description",
          transform: [1, 0, 0, 1, 92, 120],
          width: 66,
          height: 12,
          hasEOL: false,
        },
        {
          str: "IIIIIIII",
          transform: [1, 0, 0, 1, 40, 100],
          width: 16,
          height: 12,
          hasEOL: false,
        },
        {
          str: "Cable cuivre",
          transform: [1, 0, 0, 1, 66, 100],
          width: 66,
          height: 12,
          hasEOL: false,
        },
      ],
    });

    const rowLine = layoutText.split("\n")[1];
    expect(rowLine).toMatch(/^IIIIIIII\s{2,}Cable cuivre$/);
  });

  it("rejects a page before layout grouping when its text-item budget is exceeded", () => {
    const item = {
      str: "A",
      transform: [1, 0, 0, 1, 40, 120],
      width: 8,
      height: 12,
      hasEOL: false,
    };

    expect(() =>
      __testing__.buildPageLayoutText({
        items: Array.from(
          { length: __testing__.PDF_EXTRACTION_MAX_ITEMS_PER_PAGE + 1 },
          () => item
        ),
      })
    ).toThrow(/depasse 20000 éléments texte sur une page/);
  });

  it("rejects parser work that exceeds the extraction deadline", async () => {
    await expect(
      __testing__.waitWithinDeadline(
        new Promise<never>(() => undefined),
        Date.now() + 5
      )
    ).rejects.toThrow(/délai maximal d'analyse PDF/);
  });

  it("terminates a stuck PDF.js worker without invoking pdftotext on timeout", async () => {
    const { Worker } = await import("node:worker_threads");
    let worker: NodeWorker | null = null;
    let workerExit: Promise<number> | null = null;
    const fallback = vi.fn(async () => "fallback output");

    const extraction = __testing__.extractLayoutTextFromPdf(
      new File(["%PDF-1.7"], "stuck.pdf", { type: "application/pdf" }),
      async (file) =>
        __testing__.runPdfJsWorkerWithDeadline(
          await file.arrayBuffer(),
          25,
          async () => {
            const hangingWorker = new Worker("while (true) {}", { eval: true });
            worker = hangingWorker;
            workerExit = new Promise((resolve) => {
              hangingWorker.once("exit", resolve);
            });
            await new Promise<void>((resolve) => {
              hangingWorker.once("online", resolve);
            });
            return hangingWorker;
          }
        ),
      fallback
    );

    await expect(extraction).rejects.toThrow(/délai maximal d'analyse PDF/);
    await expect(workerExit).resolves.toEqual(expect.any(Number));
    expect((worker as NodeWorker | null)?.threadId).toBe(-1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("rejects pathological layout coordinates before allocating a huge line", () => {
    expect(() =>
      __testing__.buildPageLayoutText({
        items: [
          {
            str: "Code",
            transform: [1, 0, 0, 1, 40, 120],
            width: 24,
            height: 12,
            hasEOL: false,
          },
          {
            str: "A-001",
            transform: [1, 0, 0, 1, 1_000_000_000, 120],
            width: 30,
            height: 12,
            hasEOL: false,
          },
        ],
      })
    ).toThrow(/depasse la largeur maximale autorisee/);
  });

  it("rejects one oversized raw PDF.js text item before concatenation", () => {
    expect(() =>
      __testing__.buildPageLayoutText({
        items: [
          {
            str: "A".repeat(__testing__.PDF_EXTRACTION_MAX_RAW_ITEM_CHARS + 1),
            transform: [1, 0, 0, 1, 40, 120],
            width: 1,
            height: 12,
            hasEOL: false,
          },
        ],
      })
    ).toThrow(/élément texte du PDF depasse la taille maximale autorisee/);
  });

  it("rejects cumulative multi-line expansion before retaining unbounded output", () => {
    const whitespace = " ".repeat(
      __testing__.PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS
    );

    expect(() =>
      __testing__.buildPageLayoutText({
        items: Array.from(
          { length: __testing__.PDF_EXTRACTION_MAX_ITEMS_PER_PAGE },
          (_value, index) => ({
            str: whitespace,
            transform: [1, 0, 0, 1, 40, 120 - index * 4],
            width: __testing__.PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS,
            height: 1,
            hasEOL: true,
          })
        ),
      })
    ).toThrow(/texte extrait du PDF depasse la limite autorisee/);
  });

  it("bounds pdftotext stdout during execution and rejects overflow", async () => {
    const overflow = Object.assign(
      new RangeError("stdout maxBuffer length exceeded"),
      { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }
    );
    const runner = async (
      _executable: string,
      args: string[],
      options: { maxBuffer: number; timeout: number }
    ) => {
      expect(args.at(-1)).toBe("-");
      expect(options).toMatchObject({
        maxBuffer: __testing__.PDF_EXTRACTION_MAX_LAYOUT_BYTES,
        timeout: __testing__.PDF_EXTRACTION_TIMEOUT_MS,
      });
      throw overflow;
    };

    await expect(
      __testing__.extractLayoutTextFromPdfWithPdftotext(
        new File(["%PDF-1.7"], "overflow.pdf", { type: "application/pdf" }),
        runner
      )
    ).rejects.toThrow(/texte extrait du PDF depasse la limite autorisee/);
  });

  it("preserves blank lines between same-page tables in rebuilt layout text", () => {
    const layoutText = __testing__.buildPageLayoutText({
      items: [
        {
          str: "Code",
          transform: [1, 0, 0, 1, 40, 220],
          width: 24,
          height: 12,
          hasEOL: false,
        },
        {
          str: "Description",
          transform: [1, 0, 0, 1, 120, 220],
          width: 66,
          height: 12,
          hasEOL: false,
        },
        {
          str: "A-001",
          transform: [1, 0, 0, 1, 40, 200],
          width: 28,
          height: 12,
          hasEOL: false,
        },
        {
          str: "Cable",
          transform: [1, 0, 0, 1, 120, 200],
          width: 30,
          height: 12,
          hasEOL: false,
        },
        {
          str: "Code",
          transform: [1, 0, 0, 1, 40, 140],
          width: 24,
          height: 12,
          hasEOL: false,
        },
        {
          str: "Description",
          transform: [1, 0, 0, 1, 120, 140],
          width: 66,
          height: 12,
          hasEOL: false,
        },
        {
          str: "B-002",
          transform: [1, 0, 0, 1, 40, 120],
          width: 28,
          height: 12,
          hasEOL: false,
        },
        {
          str: "Gaine",
          transform: [1, 0, 0, 1, 120, 120],
          width: 32,
          height: 12,
          hasEOL: false,
        },
      ],
    });

    expect(layoutText).toContain("\n\n");
    expect(detectTabularPdfTablesFromLayout(layoutText)).toEqual([
      {
        source_page: 1,
        table_index: 0,
        title: null,
        headers: ["Code", "Description"],
        rows: [
          {
            row_index: 0,
            cells: ["A-001", "Cable"],
          },
        ],
      },
      {
        source_page: 1,
        table_index: 1,
        title: null,
        headers: ["Code", "Description"],
        rows: [
          {
            row_index: 0,
            cells: ["B-002", "Gaine"],
          },
        ],
      },
    ]);
  });
});
