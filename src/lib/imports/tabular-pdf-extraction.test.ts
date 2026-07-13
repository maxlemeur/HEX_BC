import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";

import {
  __testing__,
  detectTabularPdfTablesFromLayout,
  extractTabularPdfTablesFromFile,
} from "@/lib/imports/tabular-pdf-extraction";

describe("detectTabularPdfTablesFromLayout", () => {
  it("detects a tabular block from layout-preserved PDF text", () => {
    const result = detectTabularPdfTablesFromLayout(
      [
        "Lot CVC DPGF",
        "",
        "Code article     Description      Qt    PU HT",
        "A-001            Cable cuivre    12    450.00",
        "A-002            Disjoncteur     4     90.00",
        "",
        "Notes",
      ].join("\n")
    );

    expect(result).toEqual([
      {
        source_page: 1,
        table_index: 0,
        title: "Lot CVC DPGF",
        headers: ["Code article", "Description", "Qt", "PU HT"],
        rows: [
          {
            row_index: 0,
            cells: ["A-001", "Cable cuivre", "12", "450.00"],
          },
          {
            row_index: 1,
            cells: ["A-002", "Disjoncteur", "4", "90.00"],
          },
        ],
      },
    ]);
  });

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
    ).toThrow(/depasse 20000 elements texte sur une page/);
  });

  it("rejects parser work that exceeds the extraction deadline", async () => {
    await expect(
      __testing__.waitWithinDeadline(
        new Promise<never>(() => undefined),
        Date.now() + 5
      )
    ).rejects.toThrow(/delai maximal d'analyse PDF/);
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
    ).toThrow(/element texte du PDF depasse la taille maximale autorisee/);
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

  it("preserves legitimate bounded pdftotext output", async () => {
    const layoutText = "Code  Description\nA-001  Cable\n";
    const runner = async () => ({ stdout: layoutText });

    await expect(
      __testing__.extractLayoutTextFromPdfWithPdftotext(
        new File(["%PDF-1.7"], "valid.pdf", { type: "application/pdf" }),
        runner
      )
    ).resolves.toBe(layoutText);
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

  it("extracts tables from a PDF file without relying on host binaries", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);

    const page = document.addPage([500, 500]);
    page.drawText("Lot CVC DPGF", {
      x: 40,
      y: 430,
      font,
      size: 12,
    });
    page.drawText("Code", {
      x: 40,
      y: 400,
      font,
      size: 12,
    });
    page.drawText("Description", {
      x: 160,
      y: 400,
      font,
      size: 12,
    });
    page.drawText("Qt", {
      x: 320,
      y: 400,
      font,
      size: 12,
    });
    page.drawText("A-001", {
      x: 40,
      y: 380,
      font,
      size: 12,
    });
    page.drawText("Cable cuivre", {
      x: 160,
      y: 380,
      font,
      size: 12,
    });
    page.drawText("12", {
      x: 320,
      y: 380,
      font,
      size: 12,
    });

    const bytes = await document.save();
    const buffer = Uint8Array.from(bytes).buffer;
    const result = await extractTabularPdfTablesFromFile(
      new File([buffer], "lot-cvc.pdf", {
        type: "application/pdf",
      })
    );

    expect(result).toEqual([
      {
        source_page: 1,
        table_index: 0,
        title: "Lot CVC DPGF",
        headers: ["Code", "Description", "Qt"],
        rows: [
          {
            row_index: 0,
            cells: ["A-001", "Cable cuivre", "12"],
          },
        ],
      },
    ]);
  });

  it("extracts NIRVANA-style DPGF PDF rows with DPGF columns intact", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    const page = document.addPage([595, 842]);

    page.drawText("Projet NIRVANA - DPGF lot CVC", {
      x: 40,
      y: 780,
      font,
      size: 12,
    });

    const columns = [
      { text: "N°", x: 40 },
      { text: "Designation des ouvrages", x: 90 },
      { text: "Unite", x: 300 },
      { text: "Qte", x: 360 },
      { text: "P.U. HT", x: 420 },
      { text: "Total HT", x: 500 },
    ];
    const rows = [
      ["CVC-001", "Reseau eau glacee tube acier DN50", "ml", "42,5", "128,40", "5 457,00"],
      ["CVC-002", "Calorifuge reseau primaire", "ml", "42,5", "24,00", "1 020,00"],
      ["CVC-003", "Vanne isolement DN50", "u", "6", "215,00", "1 290,00"],
    ];

    columns.forEach((column) => {
      page.drawText(column.text, {
        x: column.x,
        y: 740,
        font,
        size: 9,
      });
    });

    rows.forEach((row, rowIndex) => {
      const y = 720 - rowIndex * 18;
      row.forEach((cell, cellIndex) => {
        page.drawText(cell, {
          x: columns[cellIndex]?.x ?? 40,
          y,
          font,
          size: 9,
        });
      });
    });

    const bytes = await document.save();
    const result = await extractTabularPdfTablesFromFile(
      new File([Uint8Array.from(bytes).buffer], "NIRVANA - DPGF lot CVC.pdf", {
        type: "application/pdf",
      })
    );

    expect(result).toEqual([
      {
        source_page: 1,
        table_index: 0,
        title: "Projet NIRVANA - DPGF lot CVC",
        headers: [
          "N°",
          "Designation des ouvrages",
          "Unite",
          "Qte",
          "P.U. HT",
          "Total HT",
        ],
        rows: [
          {
            row_index: 0,
            cells: [
              "CVC-001",
              "Reseau eau glacee tube acier DN50",
              "ml",
              "42,5",
              "128,40",
              "5 457,00",
            ],
          },
          {
            row_index: 1,
            cells: [
              "CVC-002",
              "Calorifuge reseau primaire",
              "ml",
              "42,5",
              "24,00",
              "1 020,00",
            ],
          },
          {
            row_index: 2,
            cells: [
              "CVC-003",
              "Vanne isolement DN50",
              "u",
              "6",
              "215,00",
              "1 290,00",
            ],
          },
        ],
      },
    ]);
  });
});
