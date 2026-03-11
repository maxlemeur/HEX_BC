import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchApi: vi.fn(),
  parseFile: vi.fn(),
  validatePriceBookRows: vi.fn(),
}));

vi.mock("@/components/catalogue/api", () => ({
  fetchApi: mocks.fetchApi,
}));

vi.mock("@/hooks/useFileParser", () => ({
  useFileParser: () => ({
    parseFile: mocks.parseFile,
  }),
}));

vi.mock("@/components/mappings/ColumnMapper", () => ({
  ColumnMapper: () => <div data-testid="column-mapper" />,
}));

vi.mock("@/lib/catalogue/csv-import", () => ({
  detectPriceBookProfile: vi.fn(() => "generic"),
  extractPriceBookSourceColumns: vi.fn(() => [
    "fournisseur",
    "reference_produit",
    "prix_unitaire",
  ]),
  hasMinimumPriceBookMapping: vi.fn(() => true),
  suggestPriceBookColumnMappingForProfile: vi.fn(() => ({
    fournisseur: "supplier_name",
    reference_produit: "product_reference",
    prix_unitaire: "unit_price",
  })),
  validatePriceBookRows: mocks.validatePriceBookRows,
}));

import { PriceBookCsvImport } from "./PriceBookCsvImport";

describe("PriceBookCsvImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.parseFile.mockResolvedValue({
      parser: "csv",
      rows: [
        {
          fournisseur: "CEDEO",
          reference_produit: "TUBE-INOX-28",
          prix_unitaire: "12.50",
        },
      ],
      rowLineNumbers: [2],
      detectedEncoding: "utf-8",
    });

    mocks.fetchApi.mockResolvedValue({
      id: "import-price-1",
      filename: "fournisseurs.csv",
      project_id: null,
    });

    mocks.validatePriceBookRows.mockResolvedValue({
      acceptedItems: [],
      previewRows: [],
      rejectedRows: [],
      ignoredRows: [],
      totalRows: 1,
      acceptedRows: 1,
      rejectedRowsCount: 0,
      ignoredRowsCount: 0,
      autofilledSupplierCount: 0,
      duplicateCandidatesCount: 0,
      profile: "generic",
    });
  });

  it("does not attach the affaire projectId when creating the canonical source import", async () => {
    const user = userEvent.setup();

    render(
      <PriceBookCsvImport
        onImported={vi.fn()}
        lookups={{ suppliers: [], products: [] }}
      />
    );

    const file = new File(["fournisseur;reference_produit;prix_unitaire"], "fournisseurs.csv", {
      type: "text/csv",
    });

    await user.upload(screen.getByLabelText(/Fichier CSV/i), file);
    await user.click(screen.getByRole("button", { name: /Analyser/i }));

    await waitFor(() => {
      expect(mocks.fetchApi).toHaveBeenCalledWith(
        "/api/imports",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );
    });

    const init = mocks.fetchApi.mock.calls[0]?.[1] as RequestInit;
    const formData = init.body as FormData;

    expect(formData.get("file")).toBeInstanceOf(File);
    expect(formData.get("projectId")).toBeNull();
  });
});
