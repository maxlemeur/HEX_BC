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
});
