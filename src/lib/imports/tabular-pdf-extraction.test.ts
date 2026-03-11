import { describe, expect, it } from "vitest";

import { detectTabularPdfTablesFromLayout } from "@/lib/imports/tabular-pdf-extraction";

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
});
