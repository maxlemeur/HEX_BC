import { describe, expect, it } from "vitest";

import {
  buildApprovedTabularPdfRows,
  buildTabularPdfImportReview,
} from "@/lib/imports/tabular-pdf";

describe("tabular pdf import review", () => {
  it("classifies coherent tables as light validation and suggests them", () => {
    const result = buildTabularPdfImportReview({
      sourceFileName: "lot-cfo.pdf",
      sourceDocumentId: "doc-1",
      tables: [
        {
          page: 2,
          headers: ["Code article", "Description", "Qt"],
          rows: [
            { cells: ["A-001", "Cable cuivre", "12"] },
            { cells: ["A-002", "Disjoncteur", "4"] },
          ],
        },
      ],
    });

    expect(result.review_state).toBe("light_validation");
    expect(result.summary).toMatchObject({
      total_tables: 1,
      approvable_tables: 1,
      rejected_tables: 0,
      total_rows: 2,
      approvable_rows: 2,
    });
    expect(result.suggested_approved_tables).toEqual([
      { sourcePage: 2, tableIndex: 0 },
    ]);
    expect(result.tables[0]).toMatchObject({
      source_page: 2,
      table_index: 0,
      decision: "approve",
      row_count: 2,
      headers: ["Code article", "Description", "Qt"],
    });
  });

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
});
