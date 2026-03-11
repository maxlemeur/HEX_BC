import { act, renderHook } from "@testing-library/react";
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

import { usePriceBookCsvWorkflow } from "@/components/catalogue/price-book-csv-import/usePriceBookCsvWorkflow";

const BASE_PROPS = {
  onImported: vi.fn(),
  lookups: {
    suppliers: [],
    products: [],
  },
};

describe("usePriceBookCsvWorkflow", () => {
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

  it("analyzes a selected csv through the workflow hook and creates a canonical import without projectId", async () => {
    const { result } = renderHook(() => usePriceBookCsvWorkflow(BASE_PROPS));
    const file = new File(["fournisseur;reference_produit;prix_unitaire"], "fournisseurs.csv", {
      type: "text/csv",
    });

    act(() => {
      result.current.setSelectedFile(file);
    });

    await act(async () => {
      await result.current.analyzeFile();
    });

    expect(mocks.fetchApi).toHaveBeenCalledWith(
      "/api/imports",
      expect.objectContaining({
        method: "POST",
        body: expect.any(FormData),
      })
    );

    const init = mocks.fetchApi.mock.calls[0]?.[1] as RequestInit;
    const formData = init.body as FormData;

    expect(formData.get("file")).toBe(file);
    expect(formData.get("projectId")).toBeNull();
    expect(result.current.detectedEncoding).toBe("utf-8");
    expect(result.current.sourceImportId).toBe("import-price-1");
    expect(result.current.validation?.acceptedRows).toBe(1);
    expect(mocks.validatePriceBookRows).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        fournisseur: "supplier_name",
      }),
      expect.objectContaining({
        sourceImportId: "import-price-1",
      })
    );
  });

  it("creates missing suppliers and products from workflow state without depending on component rendering", async () => {
    mocks.fetchApi
      .mockResolvedValueOnce({
        id: "import-price-1",
        filename: "unknowns.csv",
        project_id: null,
      })
      .mockResolvedValueOnce({
        createdSuppliers: [],
        createdProducts: [],
      });

    mocks.parseFile.mockResolvedValue({
      parser: "csv",
      rows: [
        {
          fournisseur: "SUPPLIER-NEW",
          reference_produit: "PRODUCT-NEW",
          prix_unitaire: "10.00",
        },
      ],
      rowLineNumbers: [2],
      detectedEncoding: "utf-8",
    });

    const rejectedValidation = {
      acceptedItems: [],
      previewRows: [],
      rejectedRows: [
        {
          lineNumber: 2,
          reason: "Unknown supplier",
          errorCode: "SUPPLIER_UNKNOWN",
          rawSupplier: "SUPPLIER-NEW",
          rawProduct: "PRODUCT-NEW",
          rawPrice: "10.00",
          suggestedFix: null,
          issues: [
            {
              code: "SUPPLIER_UNKNOWN",
              message: "Unknown supplier",
            },
            {
              code: "PRODUCT_UNKNOWN",
              message: "Unknown product",
            },
          ],
        },
      ],
      ignoredRows: [],
      totalRows: 1,
      acceptedRows: 0,
      rejectedRowsCount: 1,
      ignoredRowsCount: 0,
      autofilledSupplierCount: 0,
      duplicateCandidatesCount: 0,
      profile: "generic",
    };

    mocks.validatePriceBookRows
      .mockResolvedValueOnce(rejectedValidation)
      .mockResolvedValueOnce(rejectedValidation);

    vi.spyOn(window, "confirm").mockReturnValue(true);

    const onLookupsUpdated = vi.fn().mockResolvedValue({
      suppliers: [{ id: "supplier-2", name: "SUPPLIER-NEW" }],
      products: [{ id: "product-2", reference: "PRODUCT-NEW", designation: "New product" }],
    });

    const { result } = renderHook(() =>
      usePriceBookCsvWorkflow({
        ...BASE_PROPS,
        onLookupsUpdated,
      })
    );

    act(() => {
      result.current.setSelectedFile(
        new File(["fournisseur;reference_produit;prix_unitaire"], "unknowns.csv", {
          type: "text/csv",
        })
      );
    });

    await act(async () => {
      await result.current.analyzeFile();
    });

    await act(async () => {
      await result.current.createMissing();
    });

    expect(mocks.fetchApi).toHaveBeenNthCalledWith(
      2,
      "/api/prices/import/create-missing",
      expect.objectContaining({
        method: "POST",
      })
    );

    const body = JSON.parse(
      String((mocks.fetchApi.mock.calls[1]?.[1] as { body?: string } | undefined)?.body ?? "{}")
    );

    expect(body).toEqual({
      suppliersToCreate: ["SUPPLIER-NEW"],
      productsToCreate: ["PRODUCT-NEW"],
    });
    expect(onLookupsUpdated).toHaveBeenCalledTimes(1);
  });
});
