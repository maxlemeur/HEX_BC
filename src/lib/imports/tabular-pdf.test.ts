import { describe, expect, it } from "vitest";

import {
  buildApprovedTabularPdfRows,
  buildTabularPdfImportReview,
} from "@/lib/imports/tabular-pdf";

describe("tabular pdf import review", () => {
  it("marks degraded tables as manual_required and blocks rejected approvals", () => {
    const review = buildTabularPdfImportReview({
      sourceFileName: "lot-cfo.pdf",
      tables: [
        {
          page: 4,
          headers: [""],
          rows: [{ cells: [""] }],
        },
      ],
    });

    expect(review.review_state).toBe("manual_required");
    expect(review.tables[0]?.decision).toBe("reject");

    expect(() =>
      buildApprovedTabularPdfRows({
        body: {
          sourceFileName: "lot-cfo.pdf",
          tables: [
            {
              page: 4,
              headers: [""],
              rows: [{ cells: [""] }],
            },
          ],
        },
        approvedTables: new Set(["4:0"]),
      })
    ).toThrow(/trop degrade/i);
  });

  it("preserves overflow cells with synthetic columns on width-mismatched rows", () => {
    const result = buildApprovedTabularPdfRows({
      body: {
        sourceFileName: "lot-cfo.pdf",
        sourceDocumentId: "doc-2",
        tables: [
          {
            page: 6,
            headers: ["Code article", "Description"],
            rows: [
              { cells: ["A-001", "Cable cuivre", "12", "450.00"] },
            ],
          },
        ],
      },
      approvedTables: new Set(["6:0"]),
    });

    expect(result).toEqual([
      {
        "Code article": "A-001",
        Description: "Cable cuivre",
        column_3: "12",
        column_4: "450.00",
        _timax_provenance: {
          source_page: 6,
          table_index: 0,
          source_file_name: "lot-cfo.pdf",
          source_document_id: "doc-2",
        },
      },
    ]);
  });

  it("drops blank extracted rows before attaching provenance", () => {
    const result = buildApprovedTabularPdfRows({
      body: {
        sourceFileName: "lot-cfo.pdf",
        tables: [
          {
            page: 7,
            headers: ["Code article", "Description", "Qt"],
            rows: [
              { cells: ["", " ", ""] },
              { cells: ["A-001", "Cable cuivre", "12"] },
            ],
          },
        ],
      },
      approvedTables: new Set(["7:0"]),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      "Code article": "A-001",
      Description: "Cable cuivre",
      Qt: "12",
      _timax_provenance: {
        source_page: 7,
        table_index: 0,
      },
    });
  });
});
