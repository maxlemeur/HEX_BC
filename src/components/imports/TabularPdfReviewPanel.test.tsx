import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TabularPdfReviewPanel } from "@/components/imports/TabularPdfReviewPanel";

describe("TabularPdfReviewPanel", () => {
  it("shows suggested tables and lets the user toggle an approvable table", async () => {
    const user = userEvent.setup();
    const onToggleTable = vi.fn();

    render(
      <TabularPdfReviewPanel
        fileName="lot-cvc.pdf"
        fileSizeLabel="12.0 Ko"
        pdfReview={{
          source_file_name: "lot-cvc.pdf",
          source_document_id: null,
          tables: [],
          review: {
            review_state: "reinforced_validation",
            import_filename: "lot-cvc.pdf",
            source_file_name: "lot-cvc.pdf",
            source_document_id: null,
            summary: {
              total_tables: 1,
              approvable_tables: 1,
              rejected_tables: 0,
              total_rows: 2,
              approvable_rows: 2,
            },
            suggested_approved_tables: [{ sourcePage: 2, tableIndex: 0 }],
            tables: [
              {
                source_page: 2,
                table_index: 0,
                title: "Lot CVC",
                headers: ["Code", "Description"],
                row_count: 2,
                sample_rows: [["A-001", "Cable"]],
                decision: "review",
                issues: [],
              },
            ],
          },
        }}
        approvedTables={[{ sourcePage: 2, tableIndex: 0 }]}
        onToggleTable={onToggleTable}
        onClearFile={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
      />
    );

    expect(screen.getByText(/Validation renforcee/i)).toBeInTheDocument();
    expect(screen.getByText(/Lot CVC/)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox"));
    expect(onToggleTable).toHaveBeenCalledWith({
      sourcePage: 2,
      tableIndex: 0,
    });
  });
});
