import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,describe,expect,it } from "vitest";

import { DpgfSourceCard } from "./AffaireHub";

const linkedDpgf = {
  importId: "import-1",
  filename: "modele-sans-quantites.xlsx",
  sourceFormat: "xlsx",
  importStatus: "completed",
  mappingStatus: "validated",
  importedAt: "2026-08-01T08:00:00.000Z",
  mappingUpdatedAt: "2026-08-01T08:05:00.000Z",
  parseMode: "spreadsheet",
  rowCount: 72,
  mappedRowCount: 68,
} as const;

describe("DpgfSourceCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the restart action hidden in read-only mode", () => {
    render(<DpgfSourceCard dpgfSource={linkedDpgf} />);

    expect(
      screen.queryByRole("button", { name: "Reprendre l'import" }),
    ).not.toBeInTheDocument();
  });
});
